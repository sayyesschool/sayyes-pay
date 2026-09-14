import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/redis';

// Счётчики экранов воронки по дням. Отдаёт только числа: ничего личного тут нет,
// поэтому ключ не нужен — как и в /api/health/stats.
// Порядок шагов повторяет STEP_ORDER из public/learn_easy.html. Меняется порядок
// экранов в воронке — менять и здесь, иначе отчёт соврёт.
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const STEPS = [
  'landing', 'country', 'q_level', 'q_goal', 'social_proof',
  'q_time', 'q_format', 'q_readiness', 'progress_plan', 'q_age',
  'differentiation', 'value_reinforcement', 'language', 'contacts',
  'time_slots', 'confirmation'
];

function dayKey(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

export async function GET(request) {
  try {
    const days = Math.min(Number(request.nextUrl.searchParams.get('days') || 7), 90);
    const now = Date.now();
    const dates = [];

    for (let i = days - 1; i >= 0; i--) dates.push(dayKey(now - i * DAY));

    const byDay = {};
    const totals = {};

    for (const date of dates) {
      const raw = await kvGet('track:' + date);
      const row = raw && typeof raw === 'object' ? raw : {};
      const clean = {};

      for (const step of STEPS) {
        const value = Number(row[step] || 0);

        if (value) clean[step] = value;
        totals[step] = (totals[step] || 0) + value;
      }

      // Всё, чего нет в STEPS: старые названия экранов и russian_only.
      for (const key of Object.keys(row)) {
        if (!STEPS.includes(key)) clean[key] = Number(row[key] || 0);
      }

      byDay[date] = clean;
    }

    const base = totals.landing || 0;
    const funnel = STEPS.map(step => ({
      step,
      count: totals[step] || 0,
      ofLanding: base ? Math.round((totals[step] || 0) / base * 1000) / 10 : null
    }));

    return NextResponse.json({
      timezone: 'UTC+3',
      note: 'landing — открытие воронки, дальше экраны в порядке прохождения',
      days: byDay,
      totals,
      funnel
    }, { headers: { 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
