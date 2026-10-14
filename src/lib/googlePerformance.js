import { kvGet } from '@/lib/redis';
import { dayKey, dayList, slotStartMs, loadBookings, loadPayments, loadTraffic } from '@/lib/analytics';
import { leadSourceOf } from '@/lib/leadSource';
import { getAdsInsights } from '@/lib/metaAds';

// «Перформанс Google» (макет согласован Димой 14.10.2026).
// Расход, клики и показы по дням и по фразам шлёт скрипт Google Ads раз в час
// (/api/gads/report, ключ gads:daily). Записи, уроки и оплаты из нашей базы
// по источнику google, фраза из utm_term ({keyword} в суффиксе ссылки).
export const GADS_DAILY = 'gads:daily';
export const GADS_LAST = 'gads:report:last';

export function bareKeyword(t) {
  return String(t || '').toLowerCase().replace(/^[\s"\[+]+|[\s"\]]+$/g, '').replace(/\s+/g, ' ').trim();
}

function row(keyword) {
  return { keyword, impressions: 0, clicks: 0, spend: 0, bookings: 0, cancelled: 0, lessons: 0, attended: 0, paid: 0, revenue: 0 };
}

function finish(r) {
  return {
    ...r,
    costPerBooking: r.bookings && r.spend ? Math.round(r.spend / r.bookings) : null,
    costPerLesson: r.attended && r.spend ? Math.round(r.spend / r.attended) : null,
    romi: r.spend ? Math.round(((r.revenue - r.spend) / r.spend) * 100) : null
  };
}

function cohort(list, payments, keyOf) {
  // Записи периода и деньги по ним, независимо от даты оплаты.
  const now = Date.now();
  const rows = {};
  const of = {};
  const get = k => rows[k] || (rows[k] = row(k));

  for (const b of list) {
    const k = keyOf(b);
    const r = get(k);

    of[b.id] = k;
    r.bookings++;

    if (b.status === 'cancelled' && b.attended !== true) {
      r.cancelled++;
      continue;
    }

    const start = slotStartMs(b);

    if (start && start <= now) r.lessons++;
    if (b.attended === true) r.attended++;
  }

  const paidSet = new Set();

  for (const p of payments) {
    if (!p.bookingId || !(p.bookingId in of)) continue;

    const r = get(of[p.bookingId]);

    r.revenue += Number(p.amount || 0);
    if (!paidSet.has(p.bookingId)) {
      paidSet.add(p.bookingId);
      r.paid++;
    }
  }

  return rows;
}

export async function buildGooglePerformance({ from, to }) {
  const dates = dayList(from, to);
  const inRange = date => Boolean(date) && date >= from && date <= to;
  const [bookings, payments, traffic, daily, last, ads] = await Promise.all([
    loadBookings(), loadPayments(), loadTraffic(dates), kvGet(GADS_DAILY), kvGet(GADS_LAST), getAdsInsights({ from, to })
  ]);
  const days = daily && typeof daily === 'object' ? daily : {};

  // Экраны воронки по источнику захода.
  const steps = { google: { landing: 0, slots: 0 }, meta: { landing: 0, slots: 0 } };

  for (const date of dates) {
    const day = traffic[date] || {};

    for (const src of ['google', 'meta']) {
      steps[src].landing += Number(day['landing|' + src] || 0);
      steps[src].slots += Number(day['time_slots|' + src] || 0);
    }
  }

  const periodBookings = bookings.filter(b => inRange(dayKey(b.createdAt)));
  const gList = periodBookings.filter(b => leadSourceOf(b) === 'google');
  const mList = periodBookings.filter(b => leadSourceOf(b) === 'meta');
  const NONE = '';
  const byKw = cohort(gList, payments, b => bareKeyword((b.attribution || {}).utm_term) || NONE);
  const metaRow = Object.values(cohort(mList, payments, () => 'meta'))[0] || row('meta');

  // Расход и клики из скрипта.
  let hasDaily = false;
  const totalAds = { impressions: 0, clicks: 0, spend: 0 };

  for (const date of dates) {
    const d = days[date];

    if (!d) continue;
    hasDaily = true;
    totalAds.impressions += Number(d.impressions || 0);
    totalAds.clicks += Number(d.clicks || 0);
    totalAds.spend += Math.round(Number(d.cost || 0) * 100);

    for (const [kw, v] of Object.entries(d.kw || {})) {
      const r = byKw[kw] || (byKw[kw] = row(kw));

      r.impressions += Number(v.impressions || 0);
      r.clicks += Number(v.clicks || 0);
      r.spend += Math.round(Number(v.cost || 0) * 100);
    }
  }

  const sumKeys = ['impressions', 'clicks', 'spend', 'bookings', 'cancelled', 'lessons', 'attended', 'paid', 'revenue'];
  const total = finish(Object.values(byKw).reduce((acc, r) => {
    for (const k of ['bookings', 'cancelled', 'lessons', 'attended', 'paid', 'revenue']) acc[k] += r[k];
    return acc;
  }, { ...row('total'), ...totalAds }));

  const keywords = Object.values(byKw)
    .filter(r => sumKeys.some(k => r[k]))
    .map(finish)
    .sort((a, b) => (a.keyword === NONE) - (b.keyword === NONE) || b.spend - a.spend || b.bookings - a.bookings || b.clicks - a.clicks);

  const metaSpend = ads && ads.ok ? Math.round(Number(ads.spend || 0) * 100) : null;
  const metaClicks = ads && ads.ok ? Number(ads.linkClicks || 0) : null;

  return {
    from, to,
    hasDaily,
    total,
    keywords,
    funnel: {
      google: { clicks: hasDaily ? totalAds.clicks : null, ...steps.google, ...metaPick(total) },
      meta: { clicks: metaClicks, ...steps.meta, ...metaPick(metaRow) }
    },
    meta: {
      spend: metaSpend,
      attended: metaRow.attended,
      costPerLesson: metaSpend !== null && metaRow.attended ? Math.round(metaSpend / metaRow.attended) : null
    },
    report: last ? {
      at: last.receivedAt || null,
      status: last.stats ? last.stats.status : null,
      errors: last.errors || [],
      searchTerms: (last.searchTerms || []).slice(0, 50)
    } : null
  };
}

function metaPick(r) {
  return { bookings: r.bookings, cancelled: r.cancelled, lessons: r.lessons, attended: r.attended, paid: r.paid };
}
