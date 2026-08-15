// Единый источник правды по времени слота.
//
// Ключ слота хранится по Москве («2026-08-28_19:00»), потому что расписание
// преподавателей московское. Но человеку во всех без исключения сообщениях
// нужно показывать ЕГО время — аудитория живёт от Португалии до ОАЭ,
// это разброс в четыре часа, и «19:00 МСК» для неё бессмысленно.
//
// Часовой пояс берём из заявки: воронка кладёт IANA-имя (Europe/Berlin)
// в attribution.tz, а /api/book дублирует его в booking.tz.
// Если пояса нет (заявку завёл менеджер из бота) — честно пишем «(МСК)».

const MSK_OFFSET_HOURS = 3;
const DAYS_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// «2026-08-28_19:00» по Москве → момент времени
export function slotKeyToDate(slotKey) {
  if (!slotKey || slotKey === 'no_time') return null;
  const [datePart, timePart] = String(slotKey).split('_');
  if (!datePart || !timePart) return null;
  const [y, mo, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  if ([y, mo, d, hh, mm].some(n => Number.isNaN(n))) return null;
  return new Date(Date.UTC(y, mo - 1, d, hh - MSK_OFFSET_HOURS, mm));
}

export function tzOf(booking) {
  if (!booking) return '';
  return booking.tz || (booking.attribution && booking.attribution.tz) || '';
}

function partsIn(date, tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit', minute: '2-digit', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
    });
    const out = {};
    for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
    return out;
  } catch (e) {
    // Неизвестный или битый идентификатор пояса — не роняем сообщение
    return null;
  }
}

// Время и дата слота в поясе клиента. null, если пояс неизвестен.
export function localSlot(booking, slotKey) {
  const tz = tzOf(booking);
  const key = slotKey || (booking && booking.slot);
  const date = slotKeyToDate(key);
  if (!tz || !date) return null;
  const p = partsIn(date, tz);
  if (!p) return null;
  const jsDate = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  return {
    time: `${p.hour}:${p.minute}`,
    date: `${DAYS_RU[jsDate.getUTCDay()]}, ${Number(p.day)} ${MONTHS_RU[Number(p.month) - 1]}`,
    tz
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

// Строки для сообщений клиенту
export function clientTimeLine(booking, slotKey) {
  const t = localTimeString(booking, slotKey);
  if (t) return `Время: ${t}`;
  const msk = (booking && booking.slotMsk) || '—';
  return `Время (МСК): ${msk}`;
}

export function clientDateLine(booking, slotKey) {
  const local = localSlot(booking, slotKey);
  const d = (local && local.date) || (booking && booking.slotDate) || '—';
  return `Дата: ${d}`;
}

// «Пт, 28 авг, 18:00» — одной строкой
export function clientWhen(booking, slotKey) {
  const local = localSlot(booking, slotKey);
  if (local) return `${local.date}, ${local.time}`;
  const d = (booking && booking.slotDate) || '—';
  const t = (booking && (booking.slotLocal || booking.slotMsk)) || '—';
  const suffix = (booking && booking.slotLocal) ? '' : ' (МСК)';
  return `${d}, ${t}${suffix}`;
}

// Подпись пояса для писем и сообщений: «Berlin, UTC+2»
export function tzLabel(booking) {
  const tz = tzOf(booking);
  if (!tz) return '';
  if (tz === 'Europe/Moscow') return 'по Москве (МСК)';
  const city = tz.split('/').pop().replace(/_/g, ' ');
  try {
    const name = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName');
    return name ? `${city}, ${name.value}` : city;
  } catch (e) {
    return city;
  }
}
