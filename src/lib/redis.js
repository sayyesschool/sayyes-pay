// Shared Redis (Upstash) utilities
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const resp = await fetch(`${KV_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const data = await resp.json();
    if (data.result === null || data.result === undefined) return null;
    try { return JSON.parse(data.result); } catch { return data.result; }
  } catch (e) {
    console.error('KV get error:', key, e);
    return null;
  }
}

async function kvSet(key, value, exSeconds) {
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    let url = `${KV_URL}/set/${key}`;
    if (exSeconds) url += `/EX/${exSeconds}`;
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(value))
    });
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
    return data.result || [];
  } catch (e) {
    console.error('KV keys error:', pattern, e);
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
  await kvSet(`booking:${booking.id}`, booking);
  return booking;
}

export async function getBooking(bookingId) {
  return await kvGet(`booking:${bookingId}`);
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
  for (const key of keys) {
    const booking = await kvGet(key);
    if (booking && booking.status === 'confirmed') {
      bookings.push(booking);
    }
  }
  return bookings;
}

export { kvGet, kvSet, kvDel, kvKeys };
