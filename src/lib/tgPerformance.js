import { kvGet, kvSet } from '@/lib/redis';
import { dayKey, dayList, slotStartMs, loadBookings, loadPayments, loadTraffic } from '@/lib/analytics';
import { leadSourceOf, tgChannelOf } from '@/lib/leadSource';
import { getAdsInsights } from '@/lib/metaAds';

// «Перформанс TG»: посевы в Telegram-каналах, вход через Mini App (с 10.10.2026).
// Канал приходит из ссылки t.me/SY_school_bot/app?startapp=<канал> и пишется
// и в счётчик экранов (landing#канал), и в заявку (tgChannel). Расход на посевы
// вводится руками: пост покупается за фиксированную цену, кабинета с цифрами нет.
const SPEND_KEY = 'tgspend:list';
const NO_CHANNEL = '';

export const BOT_APP_LINK = 'https://t.me/SY_school_bot/app';

export function cleanChannel(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

export async function listTgSpend() {
  const list = await kvGet(SPEND_KEY);

  return Array.isArray(list) ? list : [];
}

export async function addTgSpend({ channel, date, amountEuro, note, by }) {
  const ch = cleanChannel(channel);
  const amount = Math.round(Number(String(amountEuro || '').replace(',', '.')) * 100);

  if (!ch) return { ok: false, error: 'Укажите канал латиницей, например cyprus_kipr' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { ok: false, error: 'Укажите дату поста' };
  if (!amount || amount < 0) return { ok: false, error: 'Сумма указана неверно' };

  const list = await listTgSpend();

  list.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    channel: ch,
    date,
    amount,
    note: String(note || '').slice(0, 80),
    by: '@' + by,
    at: new Date().toISOString()
  });
  await kvSet(SPEND_KEY, list);

  return { ok: true, message: 'Расход добавлен: @' + ch + ', ' + Math.round(amount / 100) + ' EUR' };
}

export async function deleteTgSpend(id) {
  const list = await listTgSpend();
  const next = list.filter(item => item.id !== id);

  if (next.length === list.length) return { ok: false, error: 'Запись расхода не найдена' };

  await kvSet(SPEND_KEY, next);

  return { ok: true, message: 'Расход удалён' };
}

function row(channel) {
  return {
    channel, opened: 0, slots: 0, bookings: 0, cancelled: 0, lessons: 0,
    attended: 0, paid: 0, revenue: 0, spend: 0
  };
}

function finish(r) {
  const spend = r.spend;

  return {
    ...r,
    costPerBooking: r.bookings && spend ? Math.round(spend / r.bookings) : null,
    costPerLesson: r.attended && spend ? Math.round(spend / r.attended) : null,
    romi: spend ? Math.round(((r.revenue - spend) / spend) * 100) : null
  };
}

export async function buildTgPerformance({ from, to }) {
  const dates = dayList(from, to);
  const inRange = date => Boolean(date) && date >= from && date <= to;
  const [bookings, payments, traffic, spends, ads] = await Promise.all([
    loadBookings(), loadPayments(), loadTraffic(dates), listTgSpend(), getAdsInsights({ from, to })
  ]);

  const rows = {};
  const get = channel => rows[channel] || (rows[channel] = row(channel));

  // Экраны: открытия и выбор времени по каналам. Заходы Mini App без канала
  // (из меню бота) = все заходы telegram минус сумма по каналам.
  let tgLanding = 0;
  let tgSlots = 0;

  for (const date of dates) {
    const day = traffic[date] || {};

    tgLanding += Number(day['landing|telegram'] || 0);
    tgSlots += Number(day['time_slots|telegram'] || 0);

    for (const [key, value] of Object.entries(day)) {
      const m = key.match(/^(landing|time_slots)#(.+)$/);

      if (!m) continue;

      const r = get(m[2]);

      if (m[1] === 'landing') r.opened += Number(value || 0);
      else r.slots += Number(value || 0);
    }
  }

  // Заявки из Telegram, созданные в периоде.
  const tgBookings = bookings.filter(b => leadSourceOf(b) === 'telegram' && inRange(dayKey(b.createdAt)));
  const channelOf = {};
  const now = Date.now();

  for (const b of tgBookings) {
    const ch = cleanChannel(tgChannelOf(b)) || NO_CHANNEL;
    const r = get(ch);

    channelOf[b.id] = ch;
    r.bookings++;

    if (b.status === 'cancelled' && b.attended !== true) {
      r.cancelled++;
      continue;
    }

    const start = slotStartMs(b);

    if (start && start <= now) r.lessons++;
    if (b.attended === true) r.attended++;
  }

  // Деньги этих заявок, независимо от даты оплаты: окупаемость когорты.
  const paidSet = new Set();

  for (const p of payments) {
    if (!p.bookingId || !(p.bookingId in channelOf)) continue;

    const r = get(channelOf[p.bookingId]);

    r.revenue += Number(p.amount || 0);

    if (!paidSet.has(p.bookingId)) {
      paidSet.add(p.bookingId);
      r.paid++;
    }
  }

  for (const s of spends) {
    if (!inRange(s.date)) continue;
    get(cleanChannel(s.channel)).spend += Number(s.amount || 0);
  }

  const named = Object.values(rows).filter(r => r.channel !== NO_CHANNEL);
  const sumNamed = (field) => named.reduce((acc, r) => acc + r[field], 0);
  const none = rows[NO_CHANNEL] || row(NO_CHANNEL);

  none.opened = Math.max(0, tgLanding - sumNamed('opened'));
  none.slots = Math.max(0, tgSlots - sumNamed('slots'));

  const list = named.concat(none.opened || none.bookings || none.spend ? [none] : [])
    .map(finish)
    .sort((a, b) => b.spend - a.spend || b.bookings - a.bookings);

  const total = finish(list.reduce((acc, r) => {
    for (const k of ['opened', 'slots', 'bookings', 'cancelled', 'lessons', 'attended', 'paid', 'revenue', 'spend']) acc[k] += r[k];
    return acc;
  }, row('total')));

  // Мета за тот же период для сравнения: расход кабинета / пришедшие из её заявок.
  const metaAttended = bookings.filter(b => leadSourceOf(b) === 'meta' && inRange(dayKey(b.createdAt)) && b.attended === true).length;
  const metaSpend = ads && ads.ok ? Math.round(Number(ads.spend || 0) * 100) : null;

  return {
    from, to,
    rows: list,
    total,
    meta: {
      spend: metaSpend,
      attended: metaAttended,
      costPerLesson: metaSpend !== null && metaAttended ? Math.round(metaSpend / metaAttended) : null
    },
    spends: spends.filter(s => inRange(s.date)).sort((a, b) => String(b.date).localeCompare(String(a.date)))
  };
}
