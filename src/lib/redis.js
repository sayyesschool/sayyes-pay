// Shared Redis (Upstash) utilities
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// Последняя ошибка хранилища. Нужна потому, что все функции ниже ловят сбой
// и возвращают пусто: 16.09.2026 кончился лимит бесплатного тарифа, чтения
// начали отклоняться, и это выглядело как «база стёрлась» — школа несколько
// минут считала, что потеряла все заявки. Теперь причина видна снаружи.
let lastError = null;

export function kvLastError() {
  return lastError;
}

function note(where, detail) {
  lastError = { at: new Date().toISOString(), where, detail: String(detail).slice(0, 300) };
  console.error('KV ' + where + ':', detail);
}

// Upstash отдаёт значение строкой, иногда дважды закодированной.
function decode(raw) {
  if (raw === null || raw === undefined) return null;

  try {
    const parsed = JSON.parse(raw);

    if (typeof parsed === 'string') {
      try { return JSON.parse(parsed); } catch (e) { return parsed; }
    }

    return parsed;
  } catch (e) {
    return raw;
  }
}

// Чтение пачкой. Конвейер Upstash считается за ОДИН запрос, сколько бы команд
// в нём ни было. Раньше каждая заявка читалась отдельно, и одна загрузка
// админки при 268 заявках стоила 268 обращений к хранилищу. За месяц так
// набежало 980 тысяч чтений при 13 тысячах записей — и база встала на лимите.
export async function kvMGet(keys) {
  if (!KV_URL || !KV_TOKEN || !Array.isArray(keys) || !keys.length) return [];

  const out = [];
  const CHUNK = 200;

  for (let i = 0; i < keys.length; i += CHUNK) {
    const part = keys.slice(i, i + CHUNK);
    const blanks = () => { for (let n = 0; n < part.length; n++) out.push(null); };

    try {
      const resp = await fetch(KV_URL + '/pipeline', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + KV_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(part.map(key => ['GET', key]))
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');

        note('mget http ' + resp.status, text.slice(0, 200));
        blanks();
        continue;
      }

      const data = await resp.json();

      if (!Array.isArray(data)) {
        note('mget shape', JSON.stringify(data).slice(0, 200));
        blanks();
        continue;
      }

      for (const row of data) {
        if (row && row.error) {
          note('mget row', row.error);
          out.push(null);
          continue;
        }

        out.push(decode(row ? row.result : null));
      }
    } catch (e) {
      note('mget error', e.message || e);
      blanks();
    }
  }

  return out;
}

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const resp = await fetch(`${KV_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const data = await resp.json();
    if (data.result === null || data.result === undefined) return null;
    try {
      const parsed = JSON.parse(data.result);
      // If parsed result is still a string (double-encoded), parse again
      if (typeof parsed === 'string') {
        try { return JSON.parse(parsed); } catch { return parsed; }
      }
      return parsed;
    } catch { return data.result; }
  } catch (e) {
    note('get error ' + key, e.message || e);
    return null;
  }
}

// Срок жизни ставим отдельной командой EXPIRE, а не параметром к SET.
// С параметром запись молча не сохранялась: ключи без срока (клиентская пересылка)
// работали, а все временные — mgr_reply, mgr_time — исчезали сразу после записи.
// Из-за этого менеджер не мог ответить ученику: бот не помнил, кому отвечать.
async function kvSet(key, value, exSeconds) {
  if (!KV_URL || !KV_TOKEN) return false;

  try {
    const resp = await fetch(`${KV_URL}/set/${key}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(value))
    });

    if (!resp.ok) {
      console.error('KV set failed:', key, resp.status);
      return false;
    }

    if (exSeconds) {
      const exp = await fetch(`${KV_URL}/expire/${key}/${exSeconds}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });

      // Не смогли поставить срок — ключ всё равно записан. Это лучше,
      // чем потерять его совсем.
      if (!exp.ok) console.error('KV expire failed:', key, exp.status);
    }

    return true;
  } catch (e) {
    console.error('KV set error:', key, e);
    return false;
  }
}

async function kvDel(key) {
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    await fetch(`${KV_URL}/del/${key}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    return true;
  } catch (e) {
    console.error('KV del error:', key, e);
    return false;
  }
}

async function kvKeys(pattern) {
  if (!KV_URL || !KV_TOKEN) return [];
  try {
    const resp = await fetch(`${KV_URL}/keys/${pattern}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const data = await resp.json();

    // Отказ хранилища раньше выглядел как пустой список ключей — то есть как
    // пустая база. Отличить одно от другого снаружи было невозможно.
    if (data.error) {
      note('keys ' + pattern, data.error);

      return [];
    }

    return data.result || [];
  } catch (e) {
    note('keys error ' + pattern, e.message || e);
    return [];
  }
}

// --- Booking helpers ---

export async function getBookedSlots() {
  const slots = await kvGet('booked_slots');
  return Array.isArray(slots) ? slots : [];
}

export async function addBookedSlot(slotKey) {
  const booked = await getBookedSlots();
  if (!booked.includes(slotKey)) {
    booked.push(slotKey);
    await kvSet('booked_slots', booked);
  }
}

export async function removeBookedSlot(slotKey) {
  const booked = await getBookedSlots();
  const updated = booked.filter(s => s !== slotKey);
  await kvSet('booked_slots', updated);
}

// --- Booking CRUD ---

export async function createBooking(booking) {
  // Без этой проверки заявка с пустым id ложится под ключ booking:undefined:
  // такая запись видна в списках, но ни отменить, ни отметить её нельзя.
  // Одна такая уже попала в базу — падать сразу честнее, чем копить мусор.
  if (!/^[a-z0-9]{4,16}$/.test(String(booking && booking.id || ''))) {
    throw new Error('createBooking: неверный код заявки');
  }

  await kvSet('booking:' + booking.id, booking);

  return booking;
}

// Код заявки — восемь строчных букв и цифр. Проверка нужна потому, что в базе
// обнаружилась запись под ключом booking:undefined — её карточка открывалась,
// но любое действие по ней падало. Лучше честное «не найдено», чем карточка-призрак.
function validBookingId(value) {
  return /^[a-z0-9]{4,16}$/.test(String(value || ''));
}

export async function getBooking(bookingId) {
  if (!validBookingId(bookingId)) return null;

  return await kvGet('booking:' + bookingId);
}

export async function updateBooking(bookingId, updates) {
  const booking = await getBooking(bookingId);
  if (!booking) return null;
  const updated = { ...booking, ...updates };
  await kvSet(`booking:${updated.id}`, updated);
  return updated;
}

export async function deleteBooking(bookingId) {
  return await kvDel(`booking:${bookingId}`);
}

// --- User-booking mapping ---

export async function setUserBooking(chatId, bookingId) {
  await kvSet(`user:${chatId}`, bookingId);
}

export async function getUserBooking(chatId) {
  return await kvGet(`user:${chatId}`);
}

export async function clearUserBooking(chatId) {
  await kvDel(`user:${chatId}`);
}

// --- Pending bookings (before user opens bot) ---

export async function setPendingBooking(bookingId, data) {
  // Expires in 7 days
  await kvSet(`pending:${bookingId}`, data, 604800);
}

export async function getPendingBooking(bookingId) {
  return await kvGet(`pending:${bookingId}`);
}

export async function clearPendingBooking(bookingId) {
  await kvDel(`pending:${bookingId}`);
}

// --- Manager ---

export async function setManagerChatId(chatId) {
  await kvSet('manager_chat_id', chatId);
}

export async function getManagerChatId() {
  return await kvGet('manager_chat_id');
}

// --- Get all active bookings (for reminders/reschedule) ---

export async function getAllActiveBookings() {
  const keys = await kvKeys('booking:*');
  const bookings = [];

  // Её дёргают напоминания по расписанию, то есть по несколько раз в час без участия
  // человека. Старый поштучный перебор жёг больше всего: сотни чтений каждый запуск,
  // круглые сутки, независимо от того, есть ли вообще уроки в ближайшее время.
  for (const booking of await kvMGet(keys)) {
    if (booking && booking.status === 'confirmed') {
      bookings.push(booking);
    }
  }

  return bookings;
}

export { kvGet, kvSet, kvDel, kvKeys };
