import { NextResponse } from 'next/server';

import { loadBookings, slotStartMs } from '@/lib/analytics';

// Доходимость в разрезе объявления. Отдаёт только счётчики: ни имён, ни почт.
//
// Воронка одинаковая для всех креативов, поэтому разница в доходимости между
// объявлениями это разница в людях, которых креатив приводит. Мета видит только
// запись; кто пришёл на урок, знаем только мы. Цена урока по объявлению =
// расход объявления из Меты, делённый на attended отсюда.
//
// Ключ креатива: ad_id. Если его нет, берём utm_content, но только когда там
// числовой id объявления: в старых объявлениях utm_content бывал «площадка__группа»,
// по нему креатив не определить. Остальное лежит в 'none'. Решение Димы 24.09:
// работаем со свежими данными, у каждого нового объявления обязательны UTM и ad_id.

export const dynamic = 'force-dynamic';

const DAY = 24 * 60 * 60 * 1000;

function cell() {
  return {
    adIds: [], bookings: 0, cancelled: 0, lessons: 0, attended: 0, noShow: 0, unmarked: 0, paid: 0, upcoming: 0,
    // Оплаты при любом статусе записи (деньги пришли, даже если запись закрыли или явку не отметили).
    // firstPaid: люди с первой оплатой; payments: все оплаты; revenueEur: сумма всех оплат.
    firstPaid: 0, repeatPayments: 0, payments: 0, revenueEur: 0
  };
}

function money(booking) {
  if (!booking.paid) return { first: 0, count: 0, eur: 0 };
  const count = Math.max(1, Number(booking.paymentsCount || 1));
  const cents = Number(booking.paidTotal || booking.paidAmount || 0);
  return { first: 1, count, eur: Math.round(cents / 100) };
}

function finish(c) {
  const marked = c.attended + c.noShow;

  return {
    ...c,
    // Доходимость от прошедших уроков, где явка отмечена.
    attendRate: marked ? Math.round((c.attended / marked) * 100) : null,
    // Сквозная: пришли от всех записей с прошедшим временем, включая отмены.
    attendRateOfBookings: c.bookings ? Math.round((c.attended / c.bookings) * 100) : null
  };
}

export async function GET(request) {
  try {
    const daysParam = Number(request.nextUrl.searchParams.get('days'));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;
    const now = Date.now();
    const since = now - days * DAY;

    // ?from=YYYY-MM-DD: когорта по дате заявки (с этой даты по сегодня), а не по времени урока.
    // Нужна для сравнения креативов за весь их срок: расход объявления берётся за те же даты.
    const fromParam = String(request.nextUrl.searchParams.get('from') || '');
    const fromMs = /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? Date.parse(fromParam + 'T00:00:00+03:00') : null;

    const bookings = await loadBookings();
    // Заявки без ad_id: разрез по кампании и utm_content («площадка__группа» в старых объявлениях).
    const noAdGroups = {};
    const byAd = {};
    let skippedNoSlot = 0;
    // Чем богаты заявки без ad_id: по этому видно, откуда дыра в метке.
    const noAd = { total: 0, fbclid: 0, utm_content: 0, campaign_id: 0, adset_id: 0, utm_source: {}, byMonth: {} };

    for (const booking of bookings) {
      const start = slotStartMs(booking);

      if (fromMs) {
        const created = booking.createdAt ? Date.parse(booking.createdAt) : 0;
        if (!created || created < fromMs) continue;
        if (booking.test || booking.archived) continue;
      }

      if (!start && !fromMs) {
        skippedNoSlot++;
        continue;
      }

      if (!fromMs && start < since) continue;

      const attr = booking.attribution || {};
      const contentId = /^\d{10,}$/.test(String(attr.utm_content || '')) ? String(attr.utm_content) : '';
      const ad = String(attr.ad_id || contentId || 'none');

      if (ad === 'none' && start <= now) {
        noAd.total++;
        if (attr.fbclid || attr.fbc) noAd.fbclid++;
        if (attr.utm_content) noAd.utm_content++;
        if (attr.campaign_id) noAd.campaign_id++;
        if (attr.adset_id) noAd.adset_id++;
        const src = String(attr.utm_source || '(нет)');
        noAd.utm_source[src] = (noAd.utm_source[src] || 0) + 1;
        const month = new Date(start).toISOString().slice(0, 10);
        noAd.byMonth[month] = (noAd.byMonth[month] || 0) + 1;
      }
      const c = byAd[ad] || (byAd[ad] = cell());
      const m = money(booking);
      c.firstPaid += m.first;
      c.payments += m.count;
      c.repeatPayments += Math.max(0, m.count - 1);
      c.revenueEur += m.eur;

      if (ad === 'none') {
        const g = String(attr.utm_campaign || '(нет кампании)') + ' | ' + String(attr.utm_content || '(нет)');
        const gc = noAdGroups[g] || (noAdGroups[g] = cell());
        gc.bookings++;
        if (booking.attended === true) gc.attended++;
        gc.firstPaid += m.first;
        gc.payments += m.count;
        gc.revenueEur += m.eur;
      }

      if (attr.ad_id && !c.adIds.includes(String(attr.ad_id))) c.adIds.push(String(attr.ad_id));

      // Будущий урок ещё не может ни состояться, ни сорваться: считаем отдельно.
      if (!start || start > now) {
        c.upcoming++;
        continue;
      }

      c.bookings++;

      // Отменённая запись это не урок, кроме случая, когда урок всё же прошёл.
      if (booking.status === 'cancelled' && booking.attended !== true) {
        c.cancelled++;
        continue;
      }

      c.lessons++;

      if (booking.attended === true) c.attended++;
      else if (booking.attended === false) c.noShow++;
      else c.unmarked++;

      if (booking.paid) c.paid++;
    }

    const ads = Object.entries(byAd)
      .map(([creative, c]) => ({ creative, ...finish(c) }))
      .sort((a, b) => b.bookings - a.bookings);

    return NextResponse.json({
      days,
      note: 'Записи с временем урока за последние N дней, по ad_id (или числовому utm_content). Цена урока = расход объявления в Мете / attended. Меньше ~7 записей на объявление это шум.',
      from: fromMs ? fromParam : null,
      skippedNoSlot,
      noAd,
      noAdGroups,
      ads
    });
  } catch (error) {
    return NextResponse.json({ error: String(error && error.message ? error.message : error) }, { status: 500 });
  }
}
