import { NextResponse } from 'next/server';

import { getBookedSlots } from '@/lib/redis';
import { closedSlots } from '@/lib/capacity';

// Раньше здесь была своя копия чтения из KV, которая разворачивала значение
// только один раз — из-за двойного кодирования в kvSet ответ уходил СТРОКОЙ,
// а не массивом. Теперь используем общий redis.js, который разворачивает верно.
//
// Закрытые по расписанию часы отдаём вместе с занятыми: для воронки это одно и то же —
// время, которое нельзя выбрать. Править сетку в HTML при этом не нужно.
export async function GET() {
  try {
    const booked = await getBookedSlots();

    return NextResponse.json({ booked: [...booked, ...closedSlots()] });
  } catch (e) {
    console.error('Slots error:', e);

    return NextResponse.json({ booked: closedSlots() });
  }
}
