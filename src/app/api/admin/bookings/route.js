import { NextResponse } from 'next/server';

import { kvKeys, kvGet } from '@/lib/redis';

// Полные заявки с контактами — для разбора расхождений с рекламным кабинетом.
//
// Это персональные данные клиентов, поэтому без ключа эндпоинт выключен совсем:
// открытый адрес с именами и почтами — это выгрузка базы для любого, кто угадает ссылку.
// Ключ задаётся переменной ADMIN_API_KEY и передаётся заголовком x-admin-key.
export async function GET(request) {
  const key = process.env.ADMIN_API_KEY;

  if (!key) {
    return NextResponse.json({
      error: 'Выключено: не задан ADMIN_API_KEY'
    }, { status: 503 });
  }

  if (request.headers.get('x-admin-key') !== key) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const days = Math.min(Number(request.nextUrl.searchParams.get('days') || 3), 31);
    const from = Date.now() - days * 24 * 60 * 60 * 1000;
    const keys = await kvKeys('booking:*');
    const list = [];

    for (const storageKey of keys) {
      const booking = await kvGet(storageKey);

      if (!booking || !booking.createdAt) continue;
      if (new Date(booking.createdAt).getTime() < from) continue;

      list.push({
        id: booking.id,
        createdAt: booking.createdAt,
        name: booking.name || null,
        email: booking.email || null,
        telegram: booking.telegram || null,
        phone: booking.phone || null,
        slot: booking.slot || null,
        slotDate: booking.slotDate || null,
        slotMsk: booking.slotMsk || null,
        status: booking.status || null,
        openedBot: Boolean(booking.chatId),
        confirmed: Boolean(booking.confirmed),
        attended: booking.attended === undefined ? null : booking.attended,
        attendedBy: booking.attendedBy || null,
        paid: Boolean(booking.paid),
        paidPack: booking.paidPack || null,
        archived: Boolean(booking.archived),
        releasedUnconfirmed: Boolean(booking.releasedUnconfirmed),
        emailOk: booking.emailOk === undefined ? null : booking.emailOk,
        quizAnswers: booking.quizAnswers || null
      });
    }

    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return NextResponse.json({ count: list.length, bookings: list });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
