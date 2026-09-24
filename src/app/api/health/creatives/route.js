import { NextResponse } from 'next/server';

import { loadBookings, slotStartMs } from '@/lib/analytics';

// Доходимость в разрезе объявления. Отдаёт только счётчики: ни имён, ни почт.
//
// Воронка одинаковая для всех креативов, поэтому разница в доходимости между
// объявлениями это разница в людях, которых креатив приводит. Мета видит только
// запись; кто пришёл на урок, знаем только мы. Цена урока по объявлению =
// расход объявления из Меты, делённый на attended отсюда.
//
// Ключ креатива: utm_content (имя объявления), его проставляли с самого начала.
// ad_id начали проставлять позже, поэтому он идёт вторым: только по нему
// старые записи выпали бы в 'none'. У каждого креатива отдаём список ad_id,
// чтобы сопоставить с расходом в Мете (одно имя может быть у копий в разных группах).

export const dynamic = 'force-dynamic';

const DAY = 24 * 60 * 60 * 1000;

function cell() {
  return { adIds: [], bookings: 0, cancelled: 0, lessons: 0, attended: 0, noShow: 0, unmarked: 0, paid: 0, upcoming: 0 };
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

    const bookings = await loadBookings();
    const byAd = {};
    let skippedNoSlot = 0;
    // Чем богаты заявки без ad_id: по этому видно, откуда дыра в метке.
    const noAd = { total: 0, fbclid: 0, utm_content: 0, campaign_id: 0, adset_id: 0, utm_source: {}, byMonth: {} };

    for (const booking of bookings) {
      const start = slotStartMs(booking);

      if (!start) {
        skippedNoSlot++;
        continue;
      }

      if (start < since) continue;

      const attr = booking.attribution || {};
      const ad = String(attr.utm_content || attr.ad_id || 'none');

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

      if (attr.ad_id && !c.adIds.includes(String(attr.ad_id))) c.adIds.push(String(attr.ad_id));

      // Будущий урок ещё не может ни состояться, ни сорваться: считаем отдельно.
      if (start > now) {
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
      note: 'Записи с временем урока за последние N дней, по utm_content (имя объявления), иначе по ad_id. Цена урока = расход объявления в Мете / attended. Меньше ~7 записей на объявление это шум.',
      skippedNoSlot,
      noAd,
      ads
    });
  } catch (error) {
    return NextResponse.json({ error: String(error && error.message ? error.message : error) }, { status: 500 });
  }
}
