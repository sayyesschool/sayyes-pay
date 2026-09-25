import { dayKey, dayList, loadBookings, loadTraffic, slotStartMs } from '@/lib/analytics';
import { kvGet, kvSet } from '@/lib/redis';
import { getAdsByAd, getAdsMeta } from '@/lib/metaAds';

// Креативы от показа до оплаты. Мета знает расход, показы и клики по объявлению,
// мы знаем, кто открыл воронку, записался, пришёл и заплатил. Здесь они сходятся
// по ad_id, и получается главная цифра: цена состоявшегося урока по креативу.
//
// Когорта одна на всё: заявки, созданные в выбранные даты, и расход за те же даты.
// Судьба заявки (отмена, пришёл, оплатил) берётся на сегодня, поэтому у свежих
// дат часть уроков ещё впереди, и они показаны отдельно.

// Реклама запущена 28.08: заявки раньше к креативам не привязать.
export const CREATIVES_SINCE = '2026-08-28';

// Мета отвечает секундами, а экран открывают часто. Расход держим 10 минут,
// названия и картинки 30: ссылки на картинки живут дольше. Неудачный ответ
// не кэшируем, чтобы сбой кабинета не залипал.
async function cached(key, seconds, load) {
  try {
    const hit = await kvGet(key);

    if (hit && typeof hit === 'object') return hit;
  } catch (e) {}

  const fresh = await load();

  if (fresh && fresh.ok) {
    try { await kvSet(key, fresh, seconds); } catch (e) {}
  }

  return fresh;
}

const STEPS = ['landing', 'q_level', 'contacts', 'time_slots'];

function adKeyOf(booking) {
  const attr = booking.attribution || {};
  const contentId = /^\d{10,}$/.test(String(attr.utm_content || '')) ? String(attr.utm_content) : '';

  return String(attr.ad_id || contentId || 'none');
}

function blank(id) {
  return {
    id,
    name: null,
    adset: null,
    campaign: null,
    status: null,
    image: null,
    kind: null,
    spend: 0,
    impressions: 0,
    linkClicks: 0,
    landing: 0,
    q_level: 0,
    contacts: 0,
    time_slots: 0,
    bookings: 0,
    confirmed: 0,
    cancelled: 0,
    upcoming: 0,
    lessons: 0,
    attended: 0,
    noShow: 0,
    unmarked: 0,
    paid: 0,
    revenue: 0
  };
}

const ratio = (a, b) => (b ? a / b : null);

function derive(r) {
  const past = r.bookings - r.upcoming;

  return {
    ...r,
    ctr: ratio(r.linkClicks, r.impressions),
    cpc: r.linkClicks ? r.spend / r.linkClicks : null,
    openRate: ratio(r.landing, r.linkClicks),
    contactsRate: ratio(r.contacts, r.landing),
    bookRate: ratio(r.bookings, r.landing),
    // Отмены считаем от записей, у которых время урока уже прошло или которые
    // уже отменены: будущая запись ещё может отмениться.
    past,
    cancelRate: ratio(r.cancelled, past),
    // Доходимость от уроков, где явка отмечена. Сквозная: от всех прошедших записей.
    attendRate: ratio(r.attended, r.attended + r.noShow),
    attendOfBookings: ratio(r.attended, past),
    payRate: ratio(r.paid, r.attended),
    costBooking: r.bookings ? r.spend / r.bookings : null,
    costLesson: r.attended ? r.spend / r.attended : null,
    costPaid: r.paid ? r.spend / r.paid : null,
    roas: r.spend ? r.revenue / 100 / r.spend : null
  };
}

export async function buildCreatives({ from, to }) {
  const dates = dayList(from, to);
  const [bookings, traffic, ads, meta] = await Promise.all([
    loadBookings(),
    loadTraffic(dates),
    cached('cache:crads:' + from + ':' + to, 600, () => getAdsByAd({ from, to, daily: false })),
    cached('cache:crmeta', 1800, () => getAdsMeta(null))
  ]);

  const rows = {};
  const row = id => rows[id] || (rows[id] = blank(id));
  const now = Date.now();

  if (ads.ok) {
    for (const ad of ads.ads) {
      const r = row(ad.ad_id);

      r.name = ad.ad_name;
      r.adset = ad.adset_name;
      r.campaign = ad.campaign_name;
      r.spend = ad.spend;
      r.impressions = ad.impressions;
      r.linkClicks = ad.linkClicks;
    }
  }

  // Экраны воронки по объявлению: ключи вида landing@120253052490740019.
  for (const date of dates) {
    const day = traffic[date] || {};

    for (const [key, value] of Object.entries(day)) {
      const at = key.indexOf('@');

      if (at < 0) continue;

      const step = key.slice(0, at);

      if (!STEPS.includes(step)) continue;

      row(key.slice(at + 1))[step] += Number(value || 0);
    }
  }

  for (const booking of bookings) {
    const created = dayKey(booking.createdAt);

    if (!created || created < from || created > to) continue;

    const r = row(adKeyOf(booking));
    const start = slotStartMs(booking);

    r.bookings++;
    if (booking.confirmed) r.confirmed++;

    // Оплату считаем при любом статусе записи: деньги пришли, даже если
    // менеджер не отметил явку или запись потом закрыли.
    if (booking.paid) {
      r.paid++;
      r.revenue += Number(booking.paidAmount || 0);
    }

    if (booking.status === 'cancelled' && booking.attended !== true) {
      r.cancelled++;
      continue;
    }

    if (!start || start > now) {
      r.upcoming++;
      continue;
    }

    r.lessons++;
    if (booking.attended === true) r.attended++;
    else if (booking.attended === false) r.noShow++;
    else r.unmarked++;
  }

  // Заявки без метки объявления в сравнение не идут: их расход не с чем сопоставить.
  const untagged = rows.none ? derive(rows.none) : null;

  delete rows.none;

  const list = Object.values(rows).filter(r => r.spend > 0 || r.bookings > 0 || r.landing > 0);

  if (meta.ok) {
    for (const r of list) {
      const m = meta.ads[r.id];

      if (!m) continue;

      r.name = r.name || m.name;
      r.adset = r.adset || m.adset;
      r.status = m.status;
      r.image = m.image;
      r.kind = m.kind;
    }
  }

  const total = derive(list.reduce((acc, r) => {
    for (const key of Object.keys(acc)) {
      if (typeof acc[key] === 'number') acc[key] += Number(r[key] || 0);
    }

    return acc;
  }, blank('total')));

  return {
    range: { from, to },
    adsOk: ads.ok,
    adsReason: ads.ok ? null : ads.reason,
    metaOk: meta.ok,
    metaReason: meta.ok ? null : meta.reason,
    rows: list.map(derive),
    total,
    untagged
  };
}
