import { getBooking } from '@/lib/redis';
import { buildIcs } from '@/lib/email';

// Файл календаря отдаёт сервер, а не страница.
//
// В клиентской версии в описании стояло «ссылку пришлём за час до начала», а самой
// ссылки в событии не было вовсе — человек добавлял в календарь встречу, на которую
// неоткуда подключиться. Здесь тот же buildIcs, что уходит в письме: ссылка на Zoom,
// идентификатор, код доступа и напоминание за час. Комната задаётся переменными
// окружения, поэтому при смене Zoom править нечего.
export async function GET(request) {
  const id = request.nextUrl.searchParams.get('b');
  const booking = id ? await getBooking(id) : null;
  const ics = booking ? buildIcs(booking.slot, booking.id) : null;

  if (!ics) return new Response('Not found', { status: 404 });

  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="say-yes-probny-urok.ics"',
      'cache-control': 'no-store'
    }
  });
}
