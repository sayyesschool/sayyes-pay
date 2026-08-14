import { NextResponse } from 'next/server';
import { kvGet, kvKeys } from '@/lib/redis';

// GET /api/stats?secret=<CRON_SECRET>&from=2026-08-10&to=2026-08-14
// Либо заголовок Authorization: Bearer <CRON_SECRET>
//
// Отдаёт то, чего не хватало для разбора воронки:
//  • счётчики по экранам за каждый день диапазона
//  • сколько заявок вообще создано и сколько из них имеют chatId,
//    то есть сколько человек реально нажали «Начать» в боте
//  • сколько выбрали «Нет удобного времени» вместо слота

const CRON_SECRET = process.env.CRON_SECRET;

const STEP_ORDER = [
  'landing', 'language', 'country', 'q_level', 'q_goal', 'social_proof',
  'q_time', 'q_format', 'q_readiness', 'progress_plan', 'q_age',
  'differentiation', 'value_reinforcement', 'contacts', 'time_slots', 'confirmation',
  // старые имена шагов, чтобы читались исторические дни до v4
  'qualification', 'q1_level', 'q2_goal', 'q3_time', 'q4_format',
  'q5_readiness', 'q6_age', 'q7_country', 'q8_language', 'russian_only'
];

function datesBetween(from, to) {
  const out = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length < 120) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function GET(request) {
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const secret = url.searchParams.get('secret');
  const ok = !CRON_SECRET || authHeader === `Bearer ${CRON_SECRET}` || secret === CRON_SECRET;
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const to = url.searchParams.get('to') || today;
    const from = url.searchParams.get('from') || to;
    const days = datesBetween(from, to);

    // --- Счётчики по экранам ---
    const funnel = {};
    for (const day of days) {
      const data = (await kvGet(`track:${day}`)) || {};
      const ordered = {};
      for (const step of STEP_ORDER) {
        if (data[step] !== undefined) ordered[step] = data[step];
      }
      for (const [k, v] of Object.entries(data)) {
        if (ordered[k] === undefined) ordered[k] = v;
      }
      funnel[day] = ordered;
    }

    // --- Заявки ---
    const keys = await kvKeys('booking:*');
    const all = [];
    for (const key of keys) {
      const b = await kvGet(key);
      if (b && b.id) all.push(b);
    }

    const inRange = all.filter(b => {
      const d = b.createdAt ? b.createdAt.slice(0, 10) : '';
      return d >= from && d <= to;
    });

    const summarise = list => ({
      total: list.length,
      startedBot: list.filter(b => !!b.chatId).length,
      neverStartedBot: list.filter(b => !b.chatId).length,
      pickedSlot: list.filter(b => b.slot && b.slot !== 'no_time').length,
      noTime: list.filter(b => !b.slot || b.slot === 'no_time').length,
      cancelled: list.filter(b => b.status === 'cancelled').length,
      withEmail: list.filter(b => !!b.email).length,
      withPhoneNotTg: list.filter(b => (b.telegram || '').trim().startsWith('+')).length,
      withAttribution: list.filter(b => b.attribution && (b.attribution.fbclid || b.attribution.fbc)).length
    });

    const byDay = {};
    for (const day of days) {
      const list = all.filter(b => (b.createdAt || '').slice(0, 10) === day);
      if (list.length) byDay[day] = summarise(list);
    }

    return NextResponse.json({
      range: { from, to },
      funnel,
      bookings: { range: summarise(inRange), byDay, allTime: summarise(all) },
      detail: inRange
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
        .map(b => ({
          id: b.id,
          createdAt: b.createdAt,
          name: b.name,
          contact: b.telegram,
          email: b.email || '',
          slot: b.slot,
          slotLocal: b.slotLocal || '',
          status: b.status,
          startedBot: !!b.chatId,
          reminded24h: !!b.reminded24h,
          reminded1h: !!b.reminded1h,
          attribution: b.attribution || null
        }))
    });
  } catch (e) {
    console.error('Stats error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
