import { listPages } from '@/lib/wiki';
import { buildAnalytics, loadBookings, slotStartMs, dayKey, today, shiftDay } from '@/lib/analytics';

// Помощник по проекту. Видит три вещи: базу знаний, сводные цифры
// и заявки за последние три недели. Больше ничего в модель не уходит.
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const SYSTEM = [
  'Ты — помощник внутри админки школы английского SAY YES.',
  'Отвечаешь менеджерам и управляющим по-русски, коротко и по делу.',
  'Отвечай только из данных ниже. Если данных не хватает — так и скажи,',
  'что именно неизвестно и где это посмотреть. Ничего не выдумывай.',
  'Цифры называй точно так, как они в данных, и говори, за какой они период.',
  'Если вопрос про порядок работы — опирайся на базу знаний дословно.'
].join(' ');

function shortBooking(booking) {
  return {
    код: booking.id,
    имя: booking.name || null,
    урок: booking.slot && booking.slot !== 'no_time' ? booking.slot : 'время не выбрано',
    статус: booking.status || 'confirmed',
    пришёл: booking.attended === true ? 'да' : booking.attended === false ? 'нет' : 'без отметки',
    подтвердил: Boolean(booking.confirmed),
    оплата: booking.paid ? Math.round(Number(booking.paidAmount || 0) / 100) + ' EUR' : null,
    telegram: booking.telegram || null,
    почта: booking.email || null,
    квиз: booking.quizAnswers || null
  };
}

export async function buildContext() {
  const to = today();
  const from = shiftDay(to, -29);
  const [pages, data, bookings] = await Promise.all([listPages(), buildAnalytics({ from, to }), loadBookings()]);
  const since = shiftDay(to, -20);
  const recent = bookings
    .filter(booking => {
      const start = slotStartMs(booking);
      const created = dayKey(booking.createdAt);

      return (created && created >= since) || (start && dayKey(start) >= since);
    })
    .map(shortBooking);

  const wiki = pages.length
    ? pages.map(page => '### ' + page.title + '\n' + page.body).join('\n\n')
    : 'База знаний пока пуста.';

  return [
    '# База знаний',
    wiki.slice(0, 40000),
    '',
    '# Цифры за период ' + from + ' — ' + to,
    JSON.stringify({ итоги: data.totals, воронка: data.funnel, деньги: { выручка_центы: data.money.revenue, оплат: data.money.payments, по_источникам: data.money.bySource }, требует_внимания: data.health }),
    '',
    '# Заявки с ' + since + ' (' + recent.length + ')',
    JSON.stringify(recent).slice(0, 60000)
  ].join('\n');
}

export async function askAssistant(question) {
  const key = process.env.ANTHROPIC_API_KEY;

  if (!key) {
    return { ok: false, error: 'Не задан ANTHROPIC_API_KEY — помощнику нечем думать. Ключ ставится в переменные Vercel.' };
  }

  if (!question || !question.trim()) return { ok: false, error: 'Пустой вопрос' };

  try {
    const context = await buildContext();
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: context + '\n\n# Вопрос\n' + question.trim()
        }]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      return { ok: false, error: 'Модель ответила ошибкой: ' + (data.error && data.error.message ? data.error.message : resp.status) };
    }

    const text = (data.content || []).map(part => part.text || '').join('').trim();

    return { ok: true, answer: text || 'Пустой ответ.' };
  } catch (e) {
    return { ok: false, error: 'Не получилось спросить: ' + e.message };
  }
}
