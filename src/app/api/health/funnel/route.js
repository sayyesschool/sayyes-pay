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
  'differentiation', 'budget', 'value_reinforcement', 'language', 'contacts',
  'time_slots', 'confirmation'
];

// Перенос — возврат уже записанного человека, а не открытие воронки.
// В общей конверсии он только шумит, поэтому в основной расчёт не берётся.
const NOT_A_VISIT = ['reschedule'];

function dayKey(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function funnelOf(counts) {
  const base = counts.landing || 0;

  return STEPS.map(step => ({
    step,
    count: counts[step] || 0,
    ofLanding: base ? Math.round((counts[step] || 0) / base * 1000) / 10 : null
  }));
}

export async function GET(request) {
  try {
    const days = Math.min(Number(request.nextUrl.searchParams.get('days') || 7), 90);
    const now = Date.now();
    const dates = [];

    for (let i = days - 1; i >= 0; i--) dates.push(dayKey(now - i * DAY));

    const byDay = {};
    const totals = {};
    const bySource = {};
    const byAd = {};

    for (const date of dates) {
      const raw = await kvGet('track:' + date);
      const row = raw && typeof raw === 'object' ? raw : {};
      const clean = {};

      for (const key of Object.keys(row)) {
        const value = Number(row[key] || 0);

        if (!value) continue;

        clean[key] = value;

        // Ключи вида landing|meta пишет трекер с 14.09. Всё без разделителя —
        // общий счётчик шага, он же единственный в данных до этой даты.
        // Ключ шага может нести разрез: через палку — источник (landing|meta),
        // через собаку — объявление (landing@120253052490740019). Без разделителя
        // это общий счётчик шага, он же единственный в данных до 14.09.
        const bar = key.indexOf('|');
        const at = key.indexOf('@');

        if (bar === -1 && at === -1) {
          totals[key] = (totals[key] || 0) + value;
          continue;
        }

        if (at > -1) {
          const adStep = key.slice(0, at);
          const adId = key.slice(at + 1);

          if (!byAd[adId]) byAd[adId] = {};
          byAd[adId][adStep] = (byAd[adId][adStep] || 0) + value;
          continue;
        }

        const step = key.slice(0, bar);
        const source = key.slice(bar + 1);

        if (!bySource[source]) bySource[source] = {};
        bySource[source][step] = (bySource[source][step] || 0) + value;
      }

      byDay[date] = clean;
    }

    // «Живые» заходы: всё, кроме возвратов на перенос.
    const real = {};

    for (const source of Object.keys(bySource)) {
      if (NOT_A_VISIT.includes(source)) continue;

      for (const step of Object.keys(bySource[source])) {
        real[step] = (real[step] || 0) + bySource[source][step];
      }
    }

    return NextResponse.json({
      timezone: 'UTC+3',
      note: 'landing — открытие воронки, дальше экраны в порядке прохождения; split по источникам ведётся с 14.09.2026',
      days: byDay,
      totals,
      funnel: funnelOf(totals),
      sources: Object.keys(bySource).sort().reduce((acc, key) => {
        acc[key] = { counts: bySource[key], funnel: funnelOf(bySource[key]) };
        return acc;
      }, {}),
      ads: Object.keys(byAd).sort().reduce((acc, key) => {
        acc[key] = { counts: byAd[key], funnel: funnelOf(byAd[key]) };
        return acc;
      }, {}),
      excludingReschedule: { counts: real, funnel: funnelOf(real) }
    }, { headers: { 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
