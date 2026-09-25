import { NextResponse } from 'next/server';

import { getAdsInsights, getAdsByAd } from '@/lib/metaAds';

// Расход Меты для локального growth-агента: по дням и по каждому объявлению.
// Суммы расхода в открытых эндпоинтах не отдаём, поэтому здесь ключ
// ADMIN_API_KEY (заголовок x-admin-key), как в /api/admin/bookings.
// Остальные цифры агент берёт из открытых /api/health/{funnel,creatives,gender,meta}.
export const dynamic = 'force-dynamic';

const DAY = 24 * 60 * 60 * 1000;
const mskDay = ms => new Date(ms + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

export async function GET(request) {
  const secret = process.env.ADMIN_API_KEY;

  if (!secret) {
    return NextResponse.json({ error: 'Выключено: не задан ADMIN_API_KEY' }, { status: 503 });
  }

  if (request.headers.get('x-admin-key') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const daysParam = Number(request.nextUrl.searchParams.get('days'));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 8;
  const to = mskDay(Date.now());
  const from = mskDay(Date.now() - (days - 1) * DAY);

  const [total, byAd] = await Promise.all([getAdsInsights({ from, to }), getAdsByAd({ from, to })]);

  return NextResponse.json({
    from,
    to,
    timezone: 'UTC+3',
    total: total.ok
      ? { spend: total.spend, linkClicks: total.linkClicks, impressions: total.impressions, leads: total.leads, byDay: total.byDay, campaigns: total.campaigns }
      : { error: total.reason },
    ads: byAd.ok ? byAd.ads : { error: byAd.reason }
  });
}
