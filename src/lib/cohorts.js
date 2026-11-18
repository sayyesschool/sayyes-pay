import { loadBookings, loadPayments, dayKey, dayList, slotStartMs } from '@/lib/analytics';
import { getAdsInsights } from '@/lib/metaAds';
import { listTgSpend } from '@/lib/tgPerformance';
import { GADS_DAILY } from '@/lib/googlePerformance';
import { leadSourceOf } from '@/lib/leadSource';
import { kvGet } from '@/lib/redis';
import { stripeCosts } from '@/lib/stripeFees';

// Когортный анализ (18.11.2026, решения Димы): когорта - люди, оставившие заявку
// в день / неделю / месяц; расход на рекламу в эти дни относится к когорте;
// выручка - все оплаты людей когорты до сегодня, за вычетом комиссии Stripe
// и возвратов; расход: Мета из кабинета, TG - посевы по дате, Google - выгрузка скрипта.

const SOURCES = { all: null, meta: 'meta', telegram: 'telegram', google: 'google', organic: 'direct' };
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEK_COLS = 8;

function mondayOf(date) {
  const d = new Date(date + 'T00:00:00Z');
  const shift = (d.getUTCDay() + 6) % 7;

  return new Date(d.getTime() - shift * 86400000).toISOString().slice(0, 10);
}

function periodOf(date, step) {
  if (step === 'day') return date;
  if (step === 'month') return date.slice(0, 7);

  return mondayOf(date);
}

function periodLabel(key, step) {
  if (step === 'month') {
    const [y, m] = key.split('-').map(Number);

    return MONTHS[m - 1] + ' ' + y;
  }

  const short = d => d.slice(8, 10) + '.' + d.slice(5, 7);

  if (step === 'day') return short(key);

  const end = new Date(new Date(key + 'T00:00:00Z').getTime() + 6 * 86400000).toISOString().slice(0, 10);

  return short(key) + '-' + short(end);
}

export async function buildCohorts({ from, to, step = 'week', source = 'all' }) {
  const want = SOURCES[source] === undefined ? null : SOURCES[source];
  const dates = dayList(from, to);
  const [bookings, payments, tg, gads, ads] = await Promise.all([
    loadBookings(), loadPayments(), listTgSpend(), kvGet(GADS_DAILY),
    (!want || want === 'meta') ? getAdsInsights({ from, to }) : Promise.resolve(null)
  ]);

  // Расход по дням, центы.
  const spendDay = {};
  const addSpend = (date, cents) => { spendDay[date] = (spendDay[date] || 0) + Math.round(cents); };

  if (!want || want === 'meta') {
    for (const [date, d] of Object.entries((ads && ads.ok && ads.byDay) || {})) addSpend(date, Number(d.spend || 0) * 100);
  }

  if (!want || want === 'telegram') {
    for (const s of tg) if (s.date >= from && s.date <= to) addSpend(s.date, Number(s.amount || 0));
  }

  if (!want || want === 'google') {
    for (const [date, d] of Object.entries(gads && typeof gads === 'object' ? gads : {})) {
      if (date >= from && date <= to) addSpend(date, Number(d.cost || 0) * 100);
    }
  }

  // Люди когорт: заявки периода по выбранному источнику.
  const members = bookings.filter(b => {
    const d = dayKey(b.createdAt);

    return d && d >= from && d <= to && (!want || leadSourceOf(b) === want);
  });
  const byId = new Map(members.map(b => [b.id, b]));

  const { costs, pending } = await stripeCosts(payments.filter(p => p.bookingId && byId.has(p.bookingId)));
  const netOf = p => {
    const gross = Number(p.amount || 0);
    const c = p.pi ? costs.get(String(p.pi)) : null;

    return gross - (c ? Number(c.fee || 0) + Number(c.refunded || 0) : 0);
  };

  const rows = {};
  const get = key => rows[key] || (rows[key] = {
    key, label: periodLabel(key, step), spend: 0, leads: 0, booked: 0, pastBooked: 0, confirmed: 0, attended: 0, payers: 0, revenue: 0,
    pay1: 0, pay2: 0, pay3: 0,
    weeks: Array(WEEK_COLS).fill(0), firstDay: null
  });

  for (const date of dates) get(periodOf(date, step)).spend += spendDay[date] || 0;

  for (const b of members) {
    const r = get(periodOf(dayKey(b.createdAt), step));

    r.leads++;
    if (b.slot && b.slot !== 'no_time') r.booked++;
    // Для доходимости - только записи, чей урок уже прошёл: будущие уроки её занижают.
    if (b.slot && b.slot !== 'no_time' && (slotStartMs(b) || Infinity) < Date.now()) r.pastBooked++;
    // Подтверждение: флаг сбрасывается при переносе, поэтому учитываем и пришедших.
    if (b.confirmed || b.confirmedAt || b.attended === true) r.confirmed++;
    if (b.attended === true) r.attended++;
  }

  const payerSeen = new Set();
  let unlinked = { count: 0, revenue: 0 };

  for (const p of payments) {
    const pDay = dayKey(p.at);

    if (!p.bookingId) {
      if (pDay && pDay >= from && pDay <= to) { unlinked.count++; unlinked.revenue += Number(p.amount || 0); }
      continue;
    }

    const b = byId.get(p.bookingId);

    if (!b) continue;

    const r = get(periodOf(dayKey(b.createdAt), step));
    const net = netOf(p);

    r.revenue += net;
    if (!payerSeen.has(b.id)) { payerSeen.add(b.id); r.payers++; }

    // Неделя оплаты от заявки, для таблицы накопления.
    const w = Math.max(0, Math.floor((new Date(p.at).getTime() - new Date(b.createdAt).getTime()) / (7 * 86400000)));

    r.weeks[Math.min(w, WEEK_COLS - 1)] += net;
  }

  // Первая, вторая, третья оплата: сколько людей когорты заплатили 1, 2, 3+ раз
  // (возвраты целиком не считаются оплатой).
  const payCount = new Map();

  for (const p of payments) {
    if (!p.bookingId || !byId.has(p.bookingId)) continue;
    if (netOf(p) <= 0 && Number(p.amount || 0) > 0) continue;
    payCount.set(p.bookingId, (payCount.get(p.bookingId) || 0) + 1);
  }

  for (const [id, n] of payCount) {
    const r = get(periodOf(dayKey(byId.get(id).createdAt), step));

    if (n >= 1) r.pay1++;
    if (n >= 2) r.pay2++;
    if (n >= 3) r.pay3++;
  }

  const list = Object.values(rows).sort((a, b) => b.key.localeCompare(a.key));
  const nowMs = Date.now();

  for (const r of list) {
    // Накопительно, и только для недель, которые у когорты уже прошли.
    const start = new Date((step === 'month' ? r.key + '-01' : r.key) + 'T00:00:00Z').getTime();
    const ageWeeks = Math.floor((nowMs - start) / (7 * 86400000));
    let acc = 0;

    r.cumulative = r.weeks.map((v, i) => {
      acc += v;

      return i <= ageWeeks ? acc : null;
    });
    r.ratio = r.spend ? r.revenue / r.spend : null;
    r.romi = r.spend ? Math.round(((r.revenue - r.spend) / r.spend) * 100) : null;
    r.cac = r.payers ? Math.round(r.spend / r.payers) : null;
  }

  const total = list.reduce((t, r) => {
    for (const k of ['spend', 'leads', 'booked', 'pastBooked', 'confirmed', 'attended', 'payers', 'revenue', 'pay1', 'pay2', 'pay3']) t[k] += r[k];

    return t;
  }, { spend: 0, leads: 0, booked: 0, pastBooked: 0, confirmed: 0, attended: 0, payers: 0, revenue: 0, pay1: 0, pay2: 0, pay3: 0 });

  total.ratio = total.spend ? total.revenue / total.spend : null;
  total.romi = total.spend ? Math.round(((total.revenue - total.spend) / total.spend) * 100) : null;
  total.cac = total.payers ? Math.round(total.spend / total.payers) : null;

  return {
    rows: list, total, unlinked, step, source,
    metaOk: !ads || ads.ok, feesPending: pending
  };
}
