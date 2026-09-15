// Сколько событий Мета РЕАЛЬНО приняла — по дням.
//
// Нужно, чтобы не гадать. Раньше бот помечал оплату «отмечена руками, Purchase
// мог не уйти» — это было предположение, а не проверка, и оно один раз подняло
// ложную тревогу. Здесь мы спрашиваем у Меты тот же счётчик, который показывает
// Events Manager, и сравниваем с тем, что у нас в базе.
//
// Эндпоинт /{pixel}/stats отдаёт почасовые корзины. Токен тот же, которым
// отправляем события: если у него нет прав на пиксель, честно возвращаем ошибку,
// а не молчаливый ноль — иначе «нет событий» и «не смогли посмотреть» сольются.
const GRAPH = 'https://graph.facebook.com/v21.0';
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;

const PIXELS = () => [
  { id: process.env.META_PIXEL_ID || '1405840230688968', token: process.env.META_CAPI_TOKEN, main: true },
  { id: process.env.META_PIXEL_ID_2 || '', token: process.env.META_CAPI_TOKEN_2, main: false }
].filter(p => p.id && p.token);

function dayKey(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function foldByDay(rows, eventName) {
  const byDay = {};

  for (const row of rows || []) {
    const ms = new Date(row.timestamp).getTime();

    if (Number.isNaN(ms)) continue;

    const date = dayKey(ms);

    for (const cell of row.data || []) {
      if (cell.value !== eventName) continue;

      byDay[date] = (byDay[date] || 0) + Number(cell.count || 0);
    }
  }

  return byDay;
}

export async function countEventsByDay(eventName, fromMs, toMs) {
  const targets = PIXELS();

  if (!targets.length) return { ok: false, reason: 'Не заданы META_PIXEL_ID и META_CAPI_TOKEN' };

  const out = [];

  for (const pixel of targets) {
    const url = new URL(GRAPH + '/' + pixel.id + '/stats');

    url.searchParams.set('aggregation', 'event');
    url.searchParams.set('event_name', eventName);
    url.searchParams.set('start_time', String(Math.floor(fromMs / 1000)));
    url.searchParams.set('end_time', String(Math.floor(toMs / 1000)));
    url.searchParams.set('access_token', pixel.token);

    try {
      const resp = await fetch(url.toString(), { cache: 'no-store' });
      const data = await resp.json();

      if (data.error) {
        out.push({ id: pixel.id, main: pixel.main, ok: false, reason: data.error.message || 'ошибка' });
        continue;
      }

      out.push({ id: pixel.id, main: pixel.main, ok: true, byDay: foldByDay(data.data, eventName) });
    } catch (e) {
      out.push({ id: pixel.id, main: pixel.main, ok: false, reason: String(e.message || e) });
    }
  }

  return { ok: out.some(p => p.ok), pixels: out };
}
