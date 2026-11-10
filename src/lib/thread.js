import { kvGet, kvSet } from '@/lib/redis';

// Переписка с учеником. Раньше она жила только в общем чате бота:
// через день найти, кто что ответил конкретному человеку, было невозможно.
// Храним последние 50 сообщений по заявке полгода.
const KEY = bookingId => 'thread:' + bookingId;

// channel: 'bot' (по умолчанию) или 'email' - письма цепочки и ответы на них (10.11.2026).
export async function addMessage(bookingId, { from, text, by, channel, subject }) {
  if (!bookingId || !text) return;

  try {
    const stored = await kvGet(KEY(bookingId));
    const list = Array.isArray(stored) ? stored : [];

    list.push({
      at: new Date().toISOString(),
      from,
      by: by || null,
      ...(channel === 'email' ? { channel: 'email', subject: subject ? String(subject).slice(0, 200) : null } : {}),
      text: String(text).slice(0, 4000)
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
