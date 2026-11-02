// Единый источник правды по времени слота.
//
// Ключ слота хранится в базовом поясе расписания школы, UTC+3 («2026-08-28_19:00»).
// Но человеку во всех без исключения сообщениях показывается ЕГО время: аудитория
// живёт от Португалии до ОАЭ, это разброс в четыре часа, и базовое время для неё
// бессмысленно. В клиентских текстах базовый пояс не упоминается вообще.
//
// Часовой пояс берём из заявки: воронка кладёт IANA-имя (Europe/Berlin)
// в attribution.tz, а /api/book дублирует его в booking.tz.
//
// Если пояса нет (заявку завёл менеджер из бота) — считаем по центральноевропейскому,
// потому что основная часть аудитории живёт именно там, а московское время для неё
// заведомо неверно. В таком случае к времени добавляется пометка «CET», чтобы человек
// понимал, от чего отсчитывать, если он в другом поясе.

const BASE_OFFSET_HOURS = 3;   // базовый пояс расписания школы
const BASE_TZ = 'Europe/Moscow'; // только для внутренних сравнений, клиенту не показывается
const DEFAULT_TZ = () => process.env.DEFAULT_CLIENT_TZ || 'Europe/Berlin';
const DAYS_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// «2026-08-28_19:00» в базовом поясе → момент времени
export function slotKeyToDate(slotKey) {
  if (!slotKey || slotKey === 'no_time') return null;
  const [datePart, timePart] = String(slotKey).split('_');
  if (!datePart || !timePart) return null;
  const [y, mo, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  if ([y, mo, d, hh, mm].some(n => Number.isNaN(n))) return null;
  return new Date(Date.UTC(y, mo - 1, d, hh - BASE_OFFSET_HOURS, mm));
}

export function tzOf(booking) {
  if (!booking) return '';
  return booking.tz || (booking.attribution && booking.attribution.tz) || '';
}

// Пояс клиента, а если его нет — центральноевропейский с пометкой assumed
export function resolveTz(booking) {
  const tz = tzOf(booking);
  return tz ? { tz, assumed: false } : { tz: DEFAULT_TZ(), assumed: true };
}

// Форматтер на каждый пояс создаётся один раз: создание Intl.DateTimeFormat
// дорогое, а крон зовёт эту функцию для каждой заявки.
const FMT = new Map();

function partsIn(date, tz) {
  try {
    let fmt = FMT.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit', minute: '2-digit', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
      });
      FMT.set(tz, fmt);
    }
    const out = {};
    for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
    return out;
  } catch (e) {
    // Неизвестный или битый идентификатор пояса — не роняем сообщение
    return null;
  }
}

// Время и дата слота в поясе клиента. null только если слота нет вовсе.
export function localSlot(booking, slotKey) {
  const { tz, assumed } = resolveTz(booking);
  const key = slotKey || (booking && booking.slot);
  const date = slotKeyToDate(key);
  if (!date) return null;
  const p = partsIn(date, tz);
  if (!p) return null;
  const jsDate = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  return {
    time: `${p.hour}:${p.minute}`,
    date: `${DAYS_RU[jsDate.getUTCDay()]}, ${Number(p.day)} ${MONTHS_RU[Number(p.month) - 1]}`,
    tz,
    assumed
  };
}

// «18:00» в поясе клиента, либо '' — то, что кладём в booking.slotLocal
export function localTimeString(booking, slotKey) {
  const local = localSlot(booking, slotKey);
  if (local) return local.time;
  // Тот же слот, что уже сохранён — можно взять сохранённое значение
  if (booking && (!slotKey || slotKey === booking.slot) && booking.slotLocal) return booking.slotLocal;
  return '';
}

// Строки для сообщений клиенту. Базового времени школы клиент не видит никогда:
// без известного пояса показываем центральноевропейское и помечаем его CET.
export function clientTimeLine(booking, slotKey) {
  const local = localSlot(booking, slotKey);
  if (local) return local.assumed ? `Время (CET): ${local.time}` : `Время: ${local.time}`;
  const saved = booking && booking.slotLocal;
  if (saved && (!slotKey || slotKey === booking.slot)) return `Время: ${saved}`;
  return 'Время: уточним с вами';
}

export function clientDateLine(booking, slotKey) {
  const local = localSlot(booking, slotKey);
  const d = (local && local.date) || (booking && booking.slotDate) || '—';
  return `Дата: ${d}`;
}

// «Пт, 28 авг, 18:00» — одной строкой
export function clientWhen(booking, slotKey) {
  const local = localSlot(booking, slotKey);
  if (local) return `${local.date}, ${local.time}${local.assumed ? ' (CET)' : ''}`;
  const d = (booking && booking.slotDate) || '—';
  const t = (booking && booking.slotLocal) || '—';
  return `${d}, ${t}`;
}

function offsetLabel(tz) {
  try {
    const name = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName');
    return name ? name.value : '';
  } catch (e) {
    return '';
  }
}

// Подпись пояса: «Berlin, GMT+2».
// Для пояса самой школы город не называем — в клиентских сообщениях не должно быть
// ничего, что привязывает школу к конкретной стране. Остаётся нейтральное смещение.
export function tzLabel(booking) {
  const { tz, assumed } = resolveTz(booking);
  const offset = offsetLabel(tz);
  if (assumed) return `CET${offset ? ', ' + offset : ''}`;
  if (tz === BASE_TZ) return offset || '';
  const city = tz.split('/').pop().replace(/_/g, ' ');
  return offset ? `${city}, ${offset}` : city;
}

// Готовая фраза для писем и сообщений: «Время указано …»
export function tzNoteFor(booking) {
  const { assumed } = resolveTz(booking);
  if (assumed) return 'по центральноевропейскому времени (CET)';
  const label = tzLabel(booking);
  return label ? `для вашего пояса: ${label}` : 'для вашего часового пояса';
}

// --- Тихие часы клиента ---
// 23.10.2026 Кристина записалась в 22:30 по своему времени на урок в 11:00 следующего дня.
// Памятка с просьбой подтвердить пришла ей ночью, а в 06:00 МСК автоматика сняла
// запись: формально до урока было 12,5 часа, но все они пришлись на сон.
// Правило: клиенту не пишем ночью по ЕГО времени, а «время на подтверждение»
// считаем только дневными часами.
export const DAY_START_HOUR = 9;
export const DAY_END_HOUR = 22;

export function clientHour(booking, date = new Date()) {
  const { tz } = resolveTz(booking);
  const p = partsIn(date, tz);
  if (!p) return date.getUTCHours();
  return Number(p.hour) % 24;
}

// Ночь у клиента: с 22:00 до 9:00 по его поясу.
export function isClientNight(booking, date = new Date()) {
  const h = clientHour(booking, date);
  return h >= DAY_END_HOUR || h < DAY_START_HOUR;
}

// Сколько дневных часов клиента (9:00-22:00 по его поясу) прошло между двумя моментами.
// 02.11.2026: раньше считалось шагами по 15 минут за ВЕСЬ срок с момента записи,
// для старых заявок это месяцы, и крон с 23.10 перестал укладываться во время.
// Нам важно только, набралось ли 6 дневных часов, а за любые 48 часов их
// заведомо больше 6, поэтому длинные промежутки дальше не считаем.
export function clientDayHoursBetween(booking, fromMs, toMs) {
  if (!fromMs || !toMs || toMs <= fromMs) return 0;
  if (toMs - fromMs > 48 * 60 * 60 * 1000) return 48;
  const STEP = 15 * 60 * 1000;
  let awake = 0;
  for (let t = fromMs; t < toMs; t += STEP) {
    if (!isClientNight(booking, new Date(t))) awake += Math.min(STEP, toMs - t);
  }
  return awake / (60 * 60 * 1000);
}
