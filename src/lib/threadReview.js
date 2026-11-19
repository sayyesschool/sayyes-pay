import { loadBookings } from '@/lib/analytics';
import { kvMGet, kvGet, kvSet } from '@/lib/redis';

// Разбор переписки менеджеров с учениками (19.11.2026, решение Димы): разово по кнопке
// и раз в неделю, лично Диме и Оле, в группу ничего. Смотрим скорость ответа,
// качество ответа, продажу (пакет 2 урока за 30 €) и запись/доходимость.
// Цифры по скорости считает код, разбор по смыслу - модель по самим диалогам.

const MODEL = () => process.env.ANTHROPIC_REVIEW_MODEL || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const LAST_KEY = 'review:last';
const H = 60 * 60 * 1000;

const msk = iso => {
  const d = new Date(new Date(iso).getTime() + 3 * H).toISOString();

  return d.slice(8, 10) + '.' + d.slice(5, 7) + ' ' + d.slice(11, 16);
};

// Автоматические записи в переписке - не ответы менеджера.
const isAuto = m => m.from === 'system'
  || /^(🎁 Оффер|📅 Предложение перенести урок|🔄 Перенос)/.test(String(m.text || ''))
  || /^Что помешало:/.test(String(m.text || ''));

export async function collectDialogs(days = 14) {
  const since = Date.now() - days * 24 * H;
  const bookings = (await loadBookings()).filter(b => b.id);
  const threads = await kvMGet(bookings.map(b => 'thread:' + b.id));
  const dialogs = [];

  bookings.forEach((b, i) => {
    const list = Array.isArray(threads[i]) ? threads[i] : [];
    const recent = list.filter(m => m && m.at && new Date(m.at).getTime() >= since);

    if (!recent.some(m => m.from === 'student' && !isAuto(m))) return;

    dialogs.push({ booking: b, messages: list.filter(m => m && m.at && new Date(m.at).getTime() >= since - 3 * 24 * H) });
  });

  return dialogs.sort((a, b) => {
    const la = a.messages[a.messages.length - 1].at;
    const lb = b.messages[b.messages.length - 1].at;

    return String(lb).localeCompare(String(la));
  });
}

// Скорость: на каждое сообщение ученика - первый живой ответ менеджера после него.
export function speedStats(dialogs) {
  const waits = [];
  const unanswered = [];
  const byManager = {};

  for (const d of dialogs) {
    const msgs = d.messages;

    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];

      if (m.from !== 'student' || isAuto(m)) continue;
      // Несколько сообщений ученика подряд - ждём ответа на первое.
      if (i > 0 && msgs[i - 1].from === 'student') continue;

      const reply = msgs.slice(i + 1).find(x => x.from === 'manager' && !isAuto(x));

      if (!reply) {
        // Свежие (меньше 2 часов) ещё могут ответить - не считаем пропущенными.
        if (Date.now() - new Date(m.at).getTime() > 2 * H) {
          unanswered.push({ name: d.booking.name || 'без имени', id: d.booking.id, at: msk(m.at), text: String(m.text || '').slice(0, 120) });
        }
        continue;
      }

      const mins = Math.round((new Date(reply.at).getTime() - new Date(m.at).getTime()) / 60000);
      const who = reply.by || 'менеджер';

      waits.push(mins);
      const s = byManager[who] || (byManager[who] = { replies: 0, waits: [] });

      s.replies++;
      s.waits.push(mins);
    }
  }

  const median = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);

    return s[Math.floor(s.length / 2)];
  };
  const within = (arr, limit) => arr.length ? Math.round(arr.filter(x => x <= limit).length / arr.length * 100) : null;

  return {
    questions: waits.length + unanswered.length,
    answered: waits.length,
    medianMin: median(waits),
    within30: within(waits, 30),
    within120: within(waits, 120),
    unanswered,
    byManager: Object.entries(byManager).map(([who, s]) => ({
      who, replies: s.replies, medianMin: median(s.waits), within30: within(s.waits, 30)
    })).sort((a, b) => b.replies - a.replies)
  };
}

function dialogText(d) {
  const b = d.booking;
  const status = [
    b.slot && b.slot !== 'no_time' ? 'урок ' + b.slot.replace('_', ' ') + ' МСК' : 'без времени урока',
    b.attended === true ? 'пришёл' : b.attended === false ? 'не пришёл' : 'без отметки',
    b.status === 'cancelled' ? 'запись снята/отменена' : null,
    b.paid || b.introPaid ? 'оплатил' : 'не оплатил',
    b.offer ? 'оффер запущен' : null,
    b.tz ? 'пояс ' + b.tz : null
  ].filter(Boolean).join(', ');
  const lines = d.messages.slice(-14).map(m => {
    const who = m.from === 'student' ? 'Ученик' : m.from === 'system' ? 'Система' : 'Менеджер ' + (m.by || '');
    const ch = m.channel === 'email' ? ' (письмо)' : '';

    return '[' + msk(m.at) + '] ' + who + ch + ': ' + String(m.text || '').replace(/\s+/g, ' ').slice(0, 500);
  });

  return '## ' + (b.name || 'Без имени') + ' (' + b.id + '): ' + status + '\n' + lines.join('\n');
}

const SYSTEM = [
  'Ты руководитель отдела продаж онлайн-школы английского SAY YES и разбираешь переписку менеджеров с учениками.',
  'Воронка: человек записывается на бесплатный пробный урок в Zoom (30 минут), бот просит подтвердить, после урока',
  'менеджер запускает предложение «2 урока за 30 €», оно действует 72 часа. Главная цель - чтобы ученик дошёл до урока и оплатил.',
  'Правила школы: отвечать ученику через бота (кнопка «Ответить ученику»), а не в группе; время урока писать по времени ученика,',
  'а не по МСК; отвечать быстро и по сути; вести к следующему шагу (подтвердить урок, выбрать время, оплатить пакет).',
  'Оцени по четырём направлениям: 1) скорость ответа, 2) качество ответа (по сути, вежливо, без лишнего, время по поясу ученика),',
  '3) продажа (предложили ли пакет и следующий шаг, отработали ли сомнения и цену, довели ли до оплаты),',
  '4) запись и доходимость (помогли ли записаться или перенести, напомнили ли про урок).',
  'Пиши по-русски, коротко и конкретно, как для владельца школы. Не используй длинное тире, только дефис.',
  'Формат ответа:',
  'Итог - 3-4 предложения: что в целом хорошо и что главное исправить.',
  'По каждому менеджеру (по подписи @username): что делает хорошо, что исправить - с 1-2 короткими цитатами',
  'из переписки и тем, как лучше было бы ответить.',
  'Что сделать сейчас - список учеников (имя и код), с которыми надо связаться: вопрос без ответа, не довели до оплаты, потерялись.',
  'Правила для команды - 3-5 пунктов, которые стоит закрепить.',
  'Опирайся только на диалоги и цифры ниже, ничего не выдумывай. Не пересказывай диалоги целиком.'
].join(' ');

export async function buildReview(days = 14) {
  const key = process.env.ANTHROPIC_API_KEY;

  if (!key) return { ok: false, error: 'Не задан ANTHROPIC_API_KEY' };

  const dialogs = await collectDialogs(days);
  const speed = speedStats(dialogs);

  if (!dialogs.length) return { ok: true, at: new Date().toISOString(), days, speed, dialogs: 0, text: 'За период учеников, которые писали школе, нет.' };

  const speedText = [
    'Сообщений учеников, на которые ждали ответа: ' + speed.questions + ', ответили: ' + speed.answered + '.',
    'Медиана ожидания ответа: ' + (speed.medianMin === null ? '-' : speed.medianMin + ' мин') + '; за 30 минут ответили на '
      + (speed.within30 === null ? '-' : speed.within30 + '%') + ', за 2 часа - ' + (speed.within120 === null ? '-' : speed.within120 + '%') + '.',
    'По менеджерам: ' + (speed.byManager.map(m => m.who + ' - ответов ' + m.replies + ', медиана ' + m.medianMin + ' мин').join('; ') || 'нет'),
    'Без ответа больше 2 часов: ' + (speed.unanswered.map(u => u.name + ' (' + u.id + ', ' + u.at + ')').join('; ') || 'нет')
  ].join('\n');
  // Самые свежие диалоги, чтобы уложиться в размер запроса.
  const body = dialogs.slice(0, 60).map(dialogText).join('\n\n');

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {})
      },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 3000,
        system: SYSTEM,
        messages: [{ role: 'user', content: '# Цифры за ' + days + ' дней\n' + speedText + '\n\n# Диалоги (' + Math.min(60, dialogs.length) + ' из ' + dialogs.length + ', время МСК)\n\n' + body }]
      })
    });
    const data = await resp.json();

    if (!resp.ok) return { ok: false, error: 'Модель ответила ошибкой: ' + ((data.error && data.error.message) || resp.status) };

    const text = (data.content || []).map(p => p.text || '').join('').trim().replace(/—/g, '-');
    const result = { ok: true, at: new Date().toISOString(), days, speed, dialogs: dialogs.length, text, model: MODEL() };

    await kvSet(LAST_KEY, result, 60 * 60 * 24 * 60);

    return result;
  } catch (e) {
    return { ok: false, error: 'Не получилось собрать разбор: ' + e.message };
  }
}

export async function lastReview() {
  return kvGet(LAST_KEY);
}
