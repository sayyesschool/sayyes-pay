import { NextResponse } from 'next/server';
import { getAdsInsights } from '@/lib/metaAds';

// Проверка доступа к рекламному кабинету. Наружу отдаёт только факт работоспособности
// и текст ошибки: суммы расхода в публичном эндпойнте ни к чему.
export const dynamic = 'force-dynamic';

export async function GET() {
  const to = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = new Date(Date.now() + 3 * 60 * 60 * 1000 - 6 * 86400000).toISOString().slice(0, 10);
  const result = await getAdsInsights({ from, to });

  return NextResponse.json({
    hasToken: Boolean(process.env.META_ADS_TOKEN),
    hasAccount: Boolean(process.env.META_AD_ACCOUNT_ID),
    ok: result.ok === true,
    reason: result.ok ? null : result.reason,
    days: result.ok ? Object.keys(result.byDay || {}).length : 0,
    campaigns: result.ok ? (result.campaigns || []).length : 0
  });
}
