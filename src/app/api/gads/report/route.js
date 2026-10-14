import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/redis';

// Отчёт скрипта Google Ads (запускается в аккаунте SayYes раз в час).
// Скрипт шлёт сюда, что поменял, статистику за 7 дней и поисковые запросы.
// Ключ общий со скриптом, по нему же читаем отчёт: GET ?k=...
// В отчёте нет личных данных и денег клиентов, только цифры кампании.
export const dynamic = 'force-dynamic';

const KEY = process.env.GADS_SCRIPT_KEY || '984d63632d3273b9c8ca4dd521793344';
const LAST = 'gads:report:last';
const HISTORY = 'gads:report:history';

export async function POST(request) {
  if (request.headers.get('x-gads-key') !== KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (!body) return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });

  const report = { ...body, receivedAt: new Date().toISOString() };
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
