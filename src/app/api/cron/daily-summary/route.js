import { NextResponse } from 'next/server';
import { getAllActiveBookings, kvGet } from '@/lib/redis';
import { sendMessage } from '@/lib/telegram';

const CRON_SECRET = process.env.CRON_SECRET;

// Chat IDs for daily summary recipients
// These will be resolved via username lookup or set manually
const SUMMARY_USERNAMES = ['DP_1988', 'Olia_Pi'];

async function getChatIdByUsername(username) {
  // We store chat IDs when users interact with the bot
  const key = `user_chat:${username.toLowerCase()}`;
  return await kvGet(key);
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const bookings = await getAllActiveBookings();

    // Count today's bookings
    const todayBookings = bookings.filter(b => {
      const created = b.createdAt ? b.createdAt.slice(0, 10) : '';
      return created === today;
    });

    const totalToday = todayBookings.length;
    const withoutTg = todayBookings.filter(b => {
      // Check if telegram field looks like a phone number (not a @username)
      const tg = b.telegram || '';
      return tg.startsWith('+') || /^\d{7,}$/.test(tg.replace(/\s/g, ''));
    }).length;

    const totalActive = bookings.filter(b => b.status === 'confirmed').length;

    // Get funnel stats for today
    const trackData = await kvGet(`track:${today}`) || {};

    const summaryText = `\u{1F4CA} <b>\u0415\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u0430\u044F \u0441\u0432\u043E\u0434\u043A\u0430 SAY YES</b>\n` +
      `\u{1F4C5} ${today}\n\n` +
      `<b>\u0417\u0430\u044F\u0432\u043A\u0438 \u0441\u0435\u0433\u043E\u0434\u043D\u044F:</b> ${totalToday}\n` +
      `<b>\u0418\u0437 \u043D\u0438\u0445 \u0431\u0435\u0437 Telegram \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430:</b> ${withoutTg}\n` +
      `<b>\u0412\u0441\u0435\u0433\u043E \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0437\u0430\u043F\u0438\u0441\u0435\u0439:</b> ${totalActive}\n\n` +
      `<b>\u0412\u043E\u0440\u043E\u043D\u043A\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F:</b>\n` +
      `\u2022 \u041B\u0435\u043D\u0434\u0438\u043D\u0433: ${trackData.landing || 0}\n` +
      `\u2022 \u041A\u0432\u0430\u043B\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F: ${trackData.qualification || 0}\n` +
      `\u2022 \u0412\u043E\u043F\u0440\u043E\u0441 1 (\u0443\u0440\u043E\u0432\u0435\u043D\u044C): ${trackData.q1_level || 0}\n` +
      `\u2022 \u0412\u043E\u043F\u0440\u043E\u0441 2 (\u0446\u0435\u043B\u044C): ${trackData.q2_goal || 0}\n` +
      `\u2022 Social proof: ${trackData.social_proof || 0}\n` +
      `\u2022 \u0412\u043E\u043F\u0440\u043E\u0441 3 (\u0432\u0440\u0435\u043C\u044F): ${trackData.q3_time || 0}\n` +
      `\u2022 \u0412\u043E\u043F\u0440\u043E\u0441 4 (\u0444\u043E\u0440\u043C\u0430\u0442): ${trackData.q4_format || 0}\n` +
      `\u2022 \u0412\u043E\u043F\u0440\u043E\u0441 5 (\u0433\u043E\u0442\u043E\u0432\u043D\u043E\u0441\u0442\u044C): ${trackData.q5_readiness || 0}\n` +
      `\u2022 \u041F\u043B\u0430\u043D \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441\u0430: ${trackData.progress_plan || 0}\n` +
      `\u2022 \u041A\u043E\u043D\u0442\u0430\u043A\u0442\u044B: ${trackData.contacts || 0}\n` +
      `\u2022 \u0412\u044B\u0431\u043E\u0440 \u0432\u0440\u0435\u043C\u0435\u043D\u0438: ${trackData.time_slots || 0}\n` +
      `\u2022 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435: ${trackData.confirmation || 0}`;

    let sentCount = 0;

    // Send to configured usernames
    for (const username of SUMMARY_USERNAMES) {
      const chatId = await getChatIdByUsername(username);
      if (chatId) {
        await sendMessage(chatId, summaryText);
        sentCount++;
      }
    }

    // Also send to manager
    const { getManagerChatId } = await import('@/lib/redis');
    const managerChatId = await getManagerChatId();
    if (managerChatId) {
      await sendMessage(managerChatId, summaryText);
      sentCount++;
    }

    return NextResponse.json({
      ok: true,
      totalToday,
      withoutTg,
      sentTo: sentCount,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('Daily summary error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
