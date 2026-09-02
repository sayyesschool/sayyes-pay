import { NextResponse } from 'next/server';

import { kvKeys, kvGet } from '@/lib/redis';

// Полные заявки с контактами — для разбора расхождений с рекламным кабинетом
// и работы с конкретными людьми.
//
// Это персональные данные, поэтому без ключа эндпоинт выключен совсем:
// открытый адрес с именами и почтами — это выгрузка базы для любого, кто угадает ссылку.
// Ключ задаётся переменной ADMIN_API_KEY, передаётся заголовком x-admin-key или ?key=
//
// Фильтры: ?days=N — заявки за N суток; ?lesson=YYYY-MM-DD — все уроки этого дня.
export async function GET(request) {
  const secret = process.env.ADMIN_API_KEY;

  if (!secret) {
    return NextResponse.json({ error: 'Выключено: не задан ADMIN_API_KEY' }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;
  const provided = request.headers.get('x-admin-key') || params.get('key');

  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const days = Math.min(Number(params.get('days') || 3), 31);
    const from = Date.now() - days * 24 * 60 * 60 * 1000;
    const lessonDay = params.get('lesson');
    const keys = await kvKeys('booking:*');
    const list = [];

    for (const storageKey of keys) {
      const b = await kvGet(storageKey);

      if (!b) continue;

      const slotDay = b.slot && b.slot !== 'no_time' ? String(b.slot).slice(0, 10) : null;
      const created = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      const matches = lessonDay ? slotDay === lessonDay : created >= from;

      if (!matches) continue;

      list.push({
        id: b.id,
        createdAt: b.createdAt || null,
        name: b.name || null,
        email: b.email || null,
        phone: b.phone || null,
        telegram: b.telegram || null,
        slot: b.slot || null,
        slotMsk: b.slotMsk || null,
        tz: b.tz || null,
        status: b.status || null,
        openedBot: Boolean(b.chatId),
        confirmed: Boolean(b.confirmed),
        attended: b.attended === undefined ? null : b.attended,
        attendedBy: b.attendedBy || null,
        attendedSent: Boolean(b.attendedSent),
        introTest: Boolean(b.introTest),
        confirmedVia: b.confirmedVia || null,
        reminded24h: Boolean(b.reminded24h),
        reminded1h: Boolean(b.reminded1h),
        mailed24h: Boolean(b.mailed24h),
        mailed1h: Boolean(b.mailed1h),
        attendanceAskedStage: b.attendanceAskedStage || 0,
        paid: Boolean(b.paid),
        paidPack: b.paidPack || null,
        introExpiresAt: b.introExpiresAt || null,
        archived: Boolean(b.archived),
        releasedUnconfirmed: Boolean(b.releasedUnconfirmed),
        emailOk: b.emailOk === undefined ? null : b.emailOk,
        quiz: b.quizAnswers || b.quiz || null
      });
    }

    list.sort((a, b) => String(a.slot || a.createdAt).localeCompare(String(b.slot || b.createdAt)));

    return NextResponse.json({ count: list.length, bookings: list });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
