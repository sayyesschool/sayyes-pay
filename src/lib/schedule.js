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
