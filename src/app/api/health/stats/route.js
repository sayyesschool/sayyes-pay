import { NextResponse } from 'next/server';

import { kvKeys, kvGet } from '@/lib/redis';

// Сводка по дням в том же виде, в каком её считает бот. Нужна, чтобы сверять
// цифры с рекламным кабинетом, не дёргая человека в Telegram.
// Отдаёт только числа: ни имён, ни почт, ни кодов заявок.
// Сутки считаются в базовом поясе расписания (UTC+3) — как в /today и /stats.
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;

function dayKey(value) {
  if (!value) return null;

  const time = new Date(value).getTime();

  if (Number.isNaN(time)) return null;

  return new Date(time + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function slotDayKey(booking) {
  if (!booking.slot || booking.slot === 'no_time') return null;

  return String(booking.slot).slice(0, 10);
}

function emptyDay() {
  return {
    bookings: 0,
    withSlot: 0,
    noTime: 0,
    cancelled: 0,
    releasedUnconfirmed: 0,
    openedBot: 0,
    confirmed: 0,
    lessons: 0,
    attended: 0,
    noShow: 0,
    paid: 0
  };
}

export async function GET(request) {
  try {
    const days = Math.min(Number(request.nextUrl.searchParams.get('days') || 7), 31);
    const from = Date.now() - days * 24 * 60 * 60 * 1000;
    const keys = await kvKeys('booking:*');
    const byDay = {};
    const touch = key => {
      if (!byDay[key]) byDay[key] = emptyDay();
      return byDay[key];
    };

    let archived = 0;

    for (const key of keys) {
      const booking = await kvGet(key);

      if (!booking) continue;

      if (booking.archived) {
        archived++;
        continue;
      }

      const created = dayKey(booking.createdAt);

      if (created && new Date(booking.createdAt).getTime() >= from) {
        const day = touch(created);

        day.bookings++;
        if (slotDayKey(booking)) day.withSlot++; else day.noTime++;
        if (booking.status === 'cancelled') day.cancelled++;
        if (booking.releasedUnconfirmed) day.releasedUnconfirmed++;
        if (booking.chatId) day.openedBot++;
        if (booking.confirmed) day.confirmed++;
      }

      const lessonDay = slotDayKey(booking);

      // Отменённые записи — не уроки: иначе ошибочная отметка по удалённой
      // заявке навсегда оставалась в доходимости.
      if (lessonDay && booking.status !== 'cancelled' && new Date(lessonDay).getTime() >= from) {
        const day = touch(lessonDay);

        day.lessons++;
        if (booking.attended === true && !booking.introTest) day.attended++;
        if (booking.attended === false) day.noShow++;
        if (booking.paid) day.paid++;
      }
    }

    const headers = { 'Access-Control-Allow-Origin': '*' };

    return NextResponse.json({
      timezone: 'UTC+3',
      note: 'bookings/noTime/cancelled/openedBot/confirmed — по дате заявки; lessons/attended/noShow/paid — по дате урока',
      archivedExcluded: archived,
      days: Object.keys(byDay).sort().reduce((acc, key) => {
        acc[key] = byDay[key];
        return acc;
      }, {})
    }, { headers });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
