import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/redis';
import { GADS_DAILY, bareKeyword } from '@/lib/googlePerformance';

// Отчёт скрипта Google Ads (запускается в аккаунте SayYes раз в час).
// Скрипт шлёт сюда, что поменял, статистику за 7 дней и поисковые запросы.
// Ключ общий со скриптом, по нему же читаем отчёт: GET ?k=...
// В отчёте нет личных данных и денег клиентов, только цифры кампании.
export const dynamic = 'force-dynamic';

const KEY = process.env.GADS_SCRIPT_KEY || '984d63632d3273b9c8ca4dd521793344';
const LAST = 'gads:report:last';
const HISTORY = 'gads:report:history';

// Дни из отчёта перезаписывают сохранённые: Google досчитывает расход задним числом.
async function mergeDaily(body) {
  if (!Array.isArray(body.daily) || body.daily.length === 0) return;

  const store = (await kvGet(GADS_DAILY)) || {};
  const fresh = {};

  for (const d of body.daily) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ''))) continue;
    fresh[d.date] = { impressions: Number(d.impressions || 0), clicks: Number(d.clicks || 0), cost: Number(d.cost || 0), kw: {} };
  }

  for (const k of body.keywordsDaily || []) {
    const day = fresh[k.date];
    const kw = bareKeyword(k.keyword);

    if (!day || !kw) continue;
    const v = day.kw[kw] || (day.kw[kw] = { impressions: 0, clicks: 0, cost: 0 });

    v.impressions += Number(k.impressions || 0);
    v.clicks += Number(k.clicks || 0);
    v.cost += Number(k.cost || 0);
  }

  await kvSet(GADS_DAILY, { ...store, ...fresh });
}

export async function POST(request) {
  if (request.headers.get('x-gads-key') !== KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (!body) return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });

  await mergeDaily(body);

  const { daily, keywordsDaily, ...rest } = body;
  const report = { ...rest, receivedAt: new Date().toISOString() };
  const history = (await kvGet(HISTORY)) || [];

  history.unshift({ at: report.receivedAt, version: body.version, changes: (body.changes || []).length, errors: (body.errors || []).length });
  await kvSet(LAST, report, 60 * 60 * 24 * 30);
  await kvSet(HISTORY, history.slice(0, 50), 60 * 60 * 24 * 30);

  return NextResponse.json({ ok: true });
}

export async function GET(request) {
  if (request.nextUrl.searchParams.get('k') !== KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [last, history] = await Promise.all([kvGet(LAST), kvGet(HISTORY)]);

  return NextResponse.json({ last, history: history || [] });
}
