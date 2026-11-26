import { kvGet, kvSet } from '@/lib/redis';

// Переписка с учеником. Раньше она жила только в общем чате бота:
// через день найти, кто что ответил конкретному человеку, было невозможно.
// Храним последние 50 сообщений по заявке полгода.
const KEY = bookingId => 'thread:' + bookingId;

// channel: 'bot' (по умолчанию) или 'email' - письма цепочки и ответы на них (10.11.2026).
// tg (25.11.2026): {chatId, messageId, text, markup} сообщения, ушедшего в бот. По нему
// менеджер может изменить или удалить сообщение у ученика из карточки.
export async function addMessage(bookingId, { from, text, by, channel, subject, tg, file }) {
  if (!bookingId || (!text && !file)) return;

  try {
    const stored = await kvGet(KEY(bookingId));
    const list = Array.isArray(stored) ? stored : [];

    list.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      from,
      by: by || null,
      ...(channel === 'email' ? { channel: 'email', subject: subject ? String(subject).slice(0, 200) : null } : {}),
      ...(tg && tg.chatId && tg.messageId ? { tg } : {}),
      // file: { name, size, type, fileId? } - вложение; fileId есть только у файлов, ушедших в бот.
      ...(file && file.name ? { file } : {}),
      text: String(text || '').slice(0, 4000)
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

// Правка одной записи переписки по id (изменить / удалить у ученика, 25.11.2026).
export async function updateThreadItem(bookingId, itemId, patch) {
  const stored = await kvGet(KEY(bookingId));
  const list = Array.isArray(stored) ? stored : [];
  const i = list.findIndex(item => item && item.id === itemId);

  if (i < 0) return null;

  list[i] = typeof patch === 'function' ? patch(list[i]) : { ...list[i], ...patch };
  await kvSet(KEY(bookingId), list, 60 * 60 * 24 * 180);

  return list[i];
}

// Ответ Telegram на sendMessage -> поле tg для addMessage.
export function tgRef(res, chatId, text, markup = null) {
  const messageId = res && res.ok && res.result ? res.result.message_id : null;

  return messageId ? { chatId, messageId, text, ...(markup ? { markup } : {}) } : null;
}
