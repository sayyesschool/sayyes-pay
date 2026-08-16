import { NextResponse } from 'next/server';
import { getAllActiveBookings, kvGet, getManagerChatId } from '@/lib/redis';
import { sendMessage } from '@/lib/telegram';
import { slotKeyToDate } from '@/lib/time';

const CRON_SECRET = process.env.CRON_SECRET;
const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN;

// Chat IDs for daily summary recipients
const SUMMARY_USERNAMES = ['DP_1988', 'Olia_Pi'];

async function getChatIdByUsername(username) {
  return await kvGet(`user_chat:${username.toLowerCase()}`);
}

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

async function sendDocument(chatId, csvContent, filename, caption) {
  const token = BOT_TOKEN();
  if (!token) return;
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption || '');
    form.append('parse_mode', 'HTML');
    form.append('document', new Blob([csvContent], { type: 'text/csv; charset=utf-8' }), filename);
    await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form
    });
  } catch (e) {
    console.error('sendDocument error:', e);
  }
}


// Подписи шагов. Порядок — как в воронке; старые имена оставлены, чтобы читались
// исторические дни. Ключи, которых здесь нет, всё равно попадут в сводку —
// именно из-за жёсткого списка расхождение имён однажды спрятало все цифры.
const STEP_LABELS = [
  ['landing', 'Лендинг'],
  ['language', 'Язык общения'],
  ['country', 'Страна'],
  ['q_level', 'Уровень'],
  ['q_goal', 'Цель'],
  ['social_proof', 'Отзывы и метод'],
  ['q_time', 'Часы в неделю'],
  ['q_format', 'Формат'],
  ['q_readiness', 'Готовность'],
  ['progress_plan', 'План прогресса'],
  ['q_age', 'Возраст'],
  ['differentiation', 'Кому подойдёт'],
  ['value_reinforcement', 'Что будет на уроке'],
  ['contacts', 'Контакты'],
  ['time_slots', 'Выбор времени'],
  ['confirmation', 'Подтверждение'],
  ['russian_only', 'Отсев по языку'],
  ['qualification', 'Квалификация (старое имя)'],
  ['q1_level', 'Уровень (старое имя)'],
  ['q2_goal', 'Цель (старое имя)'],
  ['q3_time', 'Часы (старое имя)'],
  ['q4_format', 'Формат (старое имя)'],
  ['q5_readiness', 'Готовность (старое имя)'],
  ['q6_age', 'Возраст (старое имя)'],
  ['q7_country', 'Страна (старое имя)'],
  ['q8_language', 'Язык (старое имя)']
];

function funnelBlock(trackData) {
  const data = trackData || {};
  const keys = Object.keys(data);
  if (keys.length === 0) {
    return '<b>Воронка сегодня:</b>\nсчётчики пусты — за день никто не открывал воронку';
  }
  const used = new Set();
  const lines = [];
  for (const [key, label] of STEP_LABELS) {
    if (data[key] === undefined) continue;
    used.add(key);
    lines.push(`• ${label}: ${data[key]}`);
  }
  // Всё, чего нет в списке подписей, показываем как есть — чтобы не потерять
  for (const key of keys) {
    if (!used.has(key)) lines.push(`• ${key}: ${data[key]}`);
  }
  return '<b>Воронка сегодня:</b>\n' + lines.join('\n');
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const bookings = await getAllActiveBookings();

    // Today's new bookings
    const todayBookings = bookings.filter(b => {
      const created = b.createdAt ? b.createdAt.slice(0, 10) : '';
      return created === today;
    });

    const totalToday = todayBookings.length;
    const withoutTg = todayBookings.filter(b => {
      const tg = b.telegram || '';
      return tg.startsWith('+') || /^\d{7,}$/.test(tg.replace(/\s/g, ''));
    }).length;
    // Раньше здесь было общее число активных записей — в него попадали и давно
    // прошедшие уроки, и цифра только росла. Считаем то, что реально впереди.
    const now = Date.now();
    const upcoming = bookings.filter(b => {
      if (b.status && b.status !== 'confirmed') return false;
      const d = slotKeyToDate(b.slot);
      return d && d.getTime() > now;
    });
    const upcomingCount = upcoming.length;
    const awaitingTime = bookings.filter(b => (!b.slot || b.slot === 'no_time') && (!b.status || b.status === 'confirmed')).length;
    // Ключевые метрики, которых раньше не было в сводке
    const startedBot = todayBookings.filter(b => !!b.chatId).length;
    const noTime = todayBookings.filter(b => !b.slot || b.slot === 'no_time').length;
    const pickedSlot = totalToday - noTime;

    // Funnel step tracking
    const trackData = await kvGet(`track:${today}`) || {};

    const summaryText =
      `📊 <b>Ежедневная сводка SAY YES</b>\n` +
      `📅 ${today}\n\n` +
      `<b>Заявки сегодня:</b> ${totalToday}\n` +
      `<b>Выбрали конкретный слот:</b> ${pickedSlot}\n` +
      `<b>Нажали «Нет удобного времени»:</b> ${noTime}\n` +
      `<b>Запустили бота («Начать»):</b> ${startedBot} из ${totalToday}\n` +
      `<b>Из них без Telegram аккаунта:</b> ${withoutTg}\n` +
      `<b>Предстоящих уроков:</b> ${upcomingCount}\n` +
      `<b>Ждут подбора времени:</b> ${awaitingTime}\n\n` +
      funnelBlock(trackData);

    // Build CSV for today's bookings
    let csvContent = null;
    if (todayBookings.length > 0) {
      // Collect all quiz answer keys across all bookings
      const quizKeys = [];
      const seenKeys = new Set();
      todayBookings.forEach(b => {
        if (b.quizAnswers && typeof b.quizAnswers === 'object') {
          Object.keys(b.quizAnswers).forEach(k => {
            if (!seenKeys.has(k)) { seenKeys.add(k); quizKeys.push(k); }
          });
        }
      });

      const headers = ['Имя', 'Telegram', 'Email', 'Дата записи', 'Время (МСК)', 'Время (локальное)', ...quizKeys, 'Запустил бота', 'fbclid', '_fbc', '_fbp', 'utm_source', 'utm_campaign', 'utm_content', 'ID', 'Время заявки'];
      const rows = todayBookings.map(b => [
        b.name || '',
        b.telegram || '',
        b.email || '',
        b.slotDate || '',
        b.slotMsk || '',
        b.slotLocal || '',
        ...quizKeys.map(k => (b.quizAnswers && b.quizAnswers[k]) ? b.quizAnswers[k] : ''),
        b.chatId ? 'да' : 'нет',
        (b.attribution && b.attribution.fbclid) || '',
        (b.attribution && b.attribution.fbc) || '',
        (b.attribution && b.attribution.fbp) || '',
        (b.attribution && b.attribution.utm_source) || '',
        (b.attribution && b.attribution.utm_campaign) || '',
        (b.attribution && b.attribution.utm_content) || '',
        b.id || '',
        b.createdAt ? b.createdAt.slice(0, 16).replace('T', ' ') : ''
      ]);

      // UTF-8 BOM for correct Excel rendering of Cyrillic
      csvContent = '\uFEFF' + headers.map(escapeCSV).join(',') + '\n' +
        rows.map(row => row.map(escapeCSV).join(',')).join('\n');
    }

    // Collect recipient chat IDs (deduplicated)
    const chatIds = new Set();
    for (const username of SUMMARY_USERNAMES) {
      const id = await getChatIdByUsername(username);
      if (id) chatIds.add(String(id));
    }
    const managerChatId = await getManagerChatId();
    if (managerChatId) chatIds.add(String(managerChatId));

    let sentCount = 0;
    for (const chatId of chatIds) {
      if (csvContent) {
        const caption = summaryText + `\n\n📎 Записи за ${today}: ${todayBookings.length} чел.`;
        await sendDocument(chatId, csvContent, `sayyes_${today}.csv`, caption);
      } else {
        await sendMessage(chatId, summaryText);
      }
      sentCount++;
    }

    return NextResponse.json({ ok: true, totalToday, upcoming: upcomingCount, awaitingTime, sentTo: sentCount, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('Daily summary error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
