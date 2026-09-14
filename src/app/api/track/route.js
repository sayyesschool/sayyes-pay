import { NextResponse } from 'next/server';
import { kvSet, kvGet } from '@/lib/redis';

// Сутки считаем в базовом поясе расписания (UTC+3) — в нём живут слоты,
// сводка бота и аналитика админки. Раньше здесь стояла дата UTC, и всё,
// что случалось с 00:00 до 03:00 МСК, ложилось во вчерашний день:
// экраны воронки и заявки разъезжались на ровном месте.
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;

export async function POST(request) {
  try {
    const { step } = await request.json();

    if (!step) return NextResponse.json({ error: 'Missing step' }, { status: 400 });

    const day = new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10);
    const key = 'track:' + day;
    const data = await kvGet(key) || {};

    data[step] = (data[step] || 0) + 1;
    await kvSet(key, data, 60 * 60 * 24 * 90);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Track error:', e);

    // Трекер никогда не должен ронять воронку: молча отвечаем ok.
    return NextResponse.json({ ok: true });
  }
}
