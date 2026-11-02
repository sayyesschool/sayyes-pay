import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/redis';

// Итог последнего запуска вечерней сводки: когда, ушла ли, сколько получателей,
// ошибки Telegram. Ни текста сводки, ни чатов, ни данных учеников.
export const dynamic = 'force-dynamic';

export async function GET() {
  const last = await kvGet('cron:daily-summary:last');
  const active = await kvGet('cron:active');

  return NextResponse.json({
    dailySummary: last || { note: 'запусков с записью статуса ещё не было' },
    // Список заявок для крона напоминаний (getCronBookings): когда было последнее
    // полное чтение базы и сколько заявок в списке. Полное чтение раз в ~55 минут.
    reminders: active && active.at
      ? { lastFullScan: new Date(Number(active.at)).toISOString(), activeIds: (active.ids || []).length }
      : { note: 'полного чтения ещё не было' }
  });
}
