import { kvGet, kvSet, getBookedSlots, addBookedSlot, removeBookedSlot } from '@/lib/redis';

// Ручное управление расписанием для управляющих.
//
// Закрытие слота реализовано через тот же список занятых времён, что и записи:
// тогда воронка, бот и серверная проверка при брони начинают считать его занятым
// сразу, без правки кода в трёх местах. Отдельный список нужен только затем,
// чтобы отличать «закрыто руками» от «занято учеником» и уметь открывать обратно.
const KEY = 'schedule:blocked';

export async function getBlocked() {
  const stored = await kvGet(KEY);

  return Array.isArray(stored) ? stored : [];
}

async function saveBlocked(list) {
  await kvSet(KEY, list);
}

export async function blockSlots(slotKeys, by) {
  const blocked = await getBlocked();
  const booked = await getBookedSlots();
  let closed = 0;

  for (const key of slotKeys) {
    if (booked.includes(key)) continue;

    if (!blocked.includes(key)) blocked.push(key);

    await addBookedSlot(key);
    closed++;
  }

  await saveBlocked(blocked);

  return { ok: true, message: 'Закрыто слотов: ' + closed, by };
}

export async function openSlots(slotKeys) {
  const blocked = await getBlocked();
  let opened = 0;

  for (const key of slotKeys) {
    // Открываем только то, что сами закрывали: чужая запись так не исчезнет.
    if (!blocked.includes(key)) continue;

    await removeBookedSlot(key);
    opened++;
  }

  await saveBlocked(blocked.filter(key => !slotKeys.includes(key)));

  return { ok: true, message: 'Открыто слотов: ' + opened };
}

// --- Часы работы по дням недели ---
//
// Раньше расписание правилось только поштучно и только на конкретную дату:
// чтобы суббота работала с 15:00, приходилось закрывать тринадцать слотов,
// и на следующую субботу всё заново. Здесь задаётся правило на день недели,
// а закрытия раскладываются вперёд на несколько недель тем же механизмом,
// что и ручные — через общий список занятых времён. Поэтому воронка, бот
// и серверная проверка при брони узнают о нём без единой правки кода.
const WEEK_KEY = 'schedule:weekhours';

// Та же сетка, что в админке и в воронке.
const GRID = [];

for (let h = 10; h <= 20; h++) {
  GRID.push(String(h).padStart(2, '0') + ':00');
  if (h < 20) GRID.push(String(h).padStart(2, '0') + ':30');
}

export async function getWeekHours() {
  const stored = await kvGet(WEEK_KEY);

  return stored && typeof stored === 'object' ? stored : {};
}

// dow: 0 — воскресенье, 6 — суббота. Пустые from/to снимают правило.
export async function setWeekHours(dow, from, to, weeks = 8) {
  const hours = await getWeekHours();
  const key = String(Number(dow));

  if (!from || !to) delete hours[key];
  else hours[key] = { from, to };

  await kvSet(WEEK_KEY, hours);

  return applyWeekHours(hours, weeks);
}

// Раскладываем правило на ближайшие недели. Слот вне интервала закрываем,
// слот внутри — открываем, но только если его закрывали мы сами: чужую запись
// и ручное закрытие менеджера правило не трогает.
export async function applyWeekHours(hours, weeks = 8) {
  const rules = hours || (await getWeekHours());
  const days = Object.keys(rules);

  if (!days.length) return { ok: true, message: 'Правил по дням недели нет' };

  const toClose = [];
  const toOpen = [];
  const today = new Date();

  for (let i = 0; i < weeks * 7; i++) {
    const date = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const rule = rules[String(date.getDay())];

    if (!rule) continue;

    const ymd = date.getFullYear() + '-'
      + String(date.getMonth() + 1).padStart(2, '0') + '-'
      + String(date.getDate()).padStart(2, '0');

    for (const time of GRID) {
      const slot = ymd + '_' + time;

      if (time < rule.from || time >= rule.to) toClose.push(slot);
      else toOpen.push(slot);
    }
  }

  await openSlots(toOpen);
  const closed = await blockSlots(toClose, 'расписание');

  return { ok: true, message: 'Часы применены. ' + closed.message };
}
