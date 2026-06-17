import { NextResponse } from 'next/server';
import { getAllActiveBookings, kvGet, getManagerChatId } from '@/lib/redis';
import { sendMessage } from '@/lib/telegram';

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
    const totalActive = bookings.length;

    // Funnel step tracking
    const trackData = await kvGet(`track:${today}`) || {};

    const summaryText =
      `📊 <b>Ежедневная сводка SAY YES</b>\n` +
      `📅 ${today}\n\n` +
      `<b>Заявки сегодня:</b> ${totalToday}\n` +
      `<b>Из них без Telegram аккаунта:</b> ${withoutTg}\n` +
      `<b>Всего активных записей:</b> ${totalActive}\n\n` +
      `<b>Воронка сегодня:</b>\n` +
      `• Лендинг: ${trackData.landing || 0}\n` +
      `• Квалификация: ${trackData.qualification || 0}\n` +
      `• Вопрос 1 (уровень): ${trackData.q1_level || 0}\n` +
      `• Вопрос 2 (цель): ${trackData.q2_goal || 0}\n` +
      `• Social proof: ${trackData.social_proof || 0}\n` +
      `• Вопрос 3 (время): ${trackData.q3_time || 0}\n` +
      `• Вопрос 4 (формат): ${trackData.q4_format || 0}\n` +
      `• Вопрос 5 (готовность): ${trackData.q5_readiness || 0}\n` +
      `• План прогресса: ${trackData.progress_plan || 0}\n` +
      `• Контакты: ${trackData.contacts || 0}\n` +
      `• Выбор времени: ${trackData.time_slots || 0}\n` +
      `• Подтверждение: ${trackData.confirmation || 0}`;

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

      const headers = ['Имя', 'Telegram', 'Email', 'Дата записи', 'Время (МСК)', ...quizKeys, 'ID', 'Время заявки'];
      const rows = todayBookings.map(b => [
        b.name || '',
        b.telegram || '',
        b.email || '',
        b.slotDate || '',
        b.slotMsk || '',
        ...quizKeys.map(k => (b.quizAnswers && b.quizAnswers[k]) ? b.quizAnswers[k] : ''),
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

    return NextResponse.json({ ok: true, totalToday, totalActive, sentTo: sentCount, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('Daily summary error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
