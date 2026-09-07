import { getBooking } from '@/lib/redis';
import { buildIcs } from '@/lib/email';
import { ZOOM_JOIN_URL, ZOOM_MEETING_ID, ZOOM_PASSCODE } from '@/lib/zoom';

// Файл календаря отдаёт сервер, а не страница.
//
// В клиентской версии в описании стояло «ссылку пришлём за час до начала», а самой
// ссылки в событии не было вовсе. Здесь тот же buildIcs, что уходит в письме.
//
// ?format=google — редирект в Google Календарь. Нужен потому, что 99,8% трафика
// приходит из мобильных приложений Instagram и Facebook, а во встроенном браузере
// скачивание .ics часто не работает — обычная ссылка работает везде.
const BASE_OFFSET_HOURS = 3;

function slotRange(slotKey) {
  if (!slotKey || slotKey === 'no_time') return null;

  const [datePart, timePart] = String(slotKey).split('_');

  if (!datePart || !timePart) return null;

  const [y, mo, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);

  if ([y, mo, d, hh, mm].some(n => Number.isNaN(n))) return null;

  const start = new Date(Date.UTC(y, mo - 1, d, hh - BASE_OFFSET_HOURS, mm));
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const stamp = dt => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  return stamp(start) + '/' + stamp(end);
}

export async function GET(request) {
  const params = request.nextUrl.searchParams;
  const id = params.get('b');
  const booking = id ? await getBooking(id) : null;

  if (!booking) return new Response('Not found', { status: 404 });

  if (params.get('format') === 'google') {
    const dates = slotRange(booking.slot);

    if (!dates) return new Response('Not found', { status: 404 });

    const details = 'Пробный урок 30 минут в Zoom.\nПодключиться: ' + ZOOM_JOIN_URL
      + '\nИдентификатор конференции: ' + ZOOM_MEETING_ID
      + '\nКод доступа: ' + ZOOM_PASSCODE;
    const url = 'https://calendar.google.com/calendar/render'
      + '?action=TEMPLATE'
      + '&text=' + encodeURIComponent('Пробный урок английского — SAY YES')
      + '&dates=' + dates
      + '&details=' + encodeURIComponent(details)
      + '&location=' + encodeURIComponent(ZOOM_JOIN_URL);

    return Response.redirect(url, 302);
  }

  const ics = buildIcs(booking.slot, booking.id);

  if (!ics) return new Response('Not found', { status: 404 });

  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="say-yes-probny-urok.ics"',
      'cache-control': 'no-store'
    }
  });
}
