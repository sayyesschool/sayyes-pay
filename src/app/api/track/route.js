import { NextResponse } from 'next/server';
import { kvSet, kvGet } from '@/lib/redis';

export async function POST(request) {
  try {
    const { step, ts } = await request.json();
    if (!step) {
      return NextResponse.json({ error: 'Missing step' }, { status: 400 });
    }

    // Get today's date key
    const today = new Date().toISOString().slice(0, 10);
    const key = `track:${today}`;

    // Increment step counter
    const data = await kvGet(key) || {};
    data[step] = (data[step] || 0) + 1;
    await kvSet(key, data, 60 * 60 * 24 * 90); // keep 90 days

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Track error:', e);
    return NextResponse.json({ ok: true }); // don't fail silently
  }
}
