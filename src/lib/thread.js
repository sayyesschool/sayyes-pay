import { kvGet, kvSet } from '@/lib/redis';

// Переписка с учеником. Раньше она жила только в общем чате бота:
// через день найти, кто что ответил конкретному человеку, было невозможно.
// Храним последние 50 сообщений по заявке полгода.
const KEY = bookingId => 'thread:' + bookingId;

export async function addMessage(bookingId, { from, text, by }) {
  if (!bookingId || !text) return;

  try {
    const stored = await kvGet(KEY(bookingId));
    const list = Array.isArray(stored) ? stored : [];

    list.push({
      at: new Date().toISOString(),
      from,
      by: by || null,
      text: String(text).slice(0, 2000)
    });

    await kvSet(KEY(bookingId), list.slice(-50), 60 * 60 * 24 * 180);
  } catch (e) {
    // Переписка — справочная вещь: её провал не должен ломать отправку сообщения.
    console.error('Thread append error:', bookingId, e);
  }
}

export async function getThread(bookingId) {
  const stored = await kvGet(KEY(bookingId));

  return Array.isArray(stored) ? stored : [];
}
