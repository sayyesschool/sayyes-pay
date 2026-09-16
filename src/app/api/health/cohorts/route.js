import { NextResponse } from 'next/server';

import { loadBookings, slotStartMs } from '@/lib/analytics';

// Кто доходит до урока, а кто нет. Отдаёт только счётчики: ни имён, ни почт.
//
// Смысл в том, чтобы отделить правила от суеверий. «Неподтверждённые не приходят»
// звучит убедительно, но решение снимать у них слот стоит живых уроков, поэтому
// цифру нужно видеть, а не помнить.
const DAY = 24 * 60 * 60 * 1000;

function cell() {
  return { lessons: 0, attended: 0, noShow: 0, unmarked: 0, paid: 0 };
}

function add(target, booking, attended) {
  target.lessons++;

  if (attended === true) target.attended++;
  else if (attended === false) target.noShow++;
  else target.unmarked++;

  if (booking.paid) target.paid++;
}

function finish(map) {
  const out = {};

  for (const key of Object.keys(map)) {
    const c = map[key];
    const marked = c.attended + c.noShow;

    out[key] = {
      ...c,
      marked,
      // Доходимость считаем от ОТМЕЧЕННЫХ, а не от всех: неотмеченный урок —
      // это дыра в учёте, а не неявка, и смешивать их значит занижать всё подряд.
      attendedPct: marked ? Math.round((c.attended / marked) * 1000) / 10 : null,
      paidPct: c.attended ? Math.round((c.paid / c.attended) * 1000) / 10 : null
    };
  }

  return out;
}

function bucketLead(hours) {
  if (hours === null) return 'неизвестно';
  if (hours < 8) return 'меньше 8 ч';
  if (hours < 24) return '8–24 ч';
  if (hours < 72) return '1–3 дня';

  return 'больше 3 дней';
}

export async function GET(request) {
  try {
    const days = Math.min(Number(request.nextUrl.searchParams.get('days') || 30), 120);
    const since = Date.now() - days * DAY;
    const now = Date.now();
    const bookings = await loadBookings();

    const groups = {
      confirmation: {},
      bot: {},
      leadTime: {},
      source: {},
      ad: {},
      quiz: {}
    };
    const quizFields = ['Страна', 'Возраст', 'Уровень', 'Цель', 'Формат', 'Готовность', 'Бюджет', 'Стаж', 'Время в неделю'];

    for (const field of quizFields) groups.quiz[field] = {};

    let total = 0;
    let confirmedCount = 0;

    for (const booking of bookings) {
      const start = slotStartMs(booking);

      if (!start || start < since || start > now) continue;

      total++;
      if (booking.confirmed) confirmedCount++;

      const attended = booking.attended;
      const attr = booking.attribution || {};
      const createdMs = booking.createdAt ? new Date(booking.createdAt).getTime() : null;
      const leadHours = createdMs ? (start - createdMs) / (60 * 60 * 1000) : null;

      const put = (map, key) => {
        const safe = String(key === undefined || key === null || key === '' ? 'не указано' : key).slice(0, 60);

        if (!map[safe]) map[safe] = cell();
        add(map[safe], booking, attended);
      };

      put(groups.confirmation, booking.confirmed ? 'подтвердил' : 'не подтвердил');
      put(groups.bot, booking.chatId ? 'открыл бота' : 'без бота');
      put(groups.leadTime, bucketLead(leadHours));
      put(groups.source, attr.utm_source || (attr.fbclid || attr.ad_id ? 'meta' : 'без метки'));
      put(groups.ad, attr.ad_id || 'без объявления');

      const answers = booking.quizAnswers || {};

      for (const field of quizFields) put(groups.quiz[field], answers[field]);
    }

    const quiz = {};

    for (const field of quizFields) quiz[field] = finish(groups.quiz[field]);

    return NextResponse.json({
      note: 'Только уроки, которые уже прошли. Доходимость считается от отмеченных.',
      days,
      lessons: total,
      confirmedPct: total ? Math.round((confirmedCount / total) * 1000) / 10 : null,
      confirmation: finish(groups.confirmation),
      bot: finish(groups.bot),
      leadTime: finish(groups.leadTime),
      source: finish(groups.source),
      ad: finish(groups.ad),
      quiz
    }, { headers: { 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
