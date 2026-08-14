import { NextResponse } from 'next/server';
import { getBookedSlots } from '@/lib/redis';

// Раньше здесь была своя копия чтения из KV, которая разворачивала значение
// только один раз — из-за двойного кодирования в kvSet ответ уходил СТРОКОЙ,
// а не массивом. Теперь используем общий redis.js, который разворачивает верно.
export async function GET() {
  try {
    const booked = await getBookedSlots();
    return NextResponse.json({ booked });
  } catch (e) {
    console.error('Slots error:', e);
    return NextResponse.json({ booked: [] });
  }
}
