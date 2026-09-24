import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/redis';

// Итог последнего запуска вечерней сводки: когда, ушла ли, сколько получателей,
// ошибки Telegram. Ни текста сводки, ни чатов, ни данных учеников.
export const dynamic = 'force-dynamic';

export async function GET() {
  const last = await kvGet('cron:daily-summary:last');

  return NextResponse.json({
    dailySummary: last || { note: 'запусков с записью статуса ещё не было' }
  });
}
