import { getManagerChatId, kvGet } from '@/lib/redis';
import { sendMessage, MANAGER_USERNAMES } from '@/lib/telegram';

// Telegram не даёт боту писать человеку первым, поэтому chat id менеджера
// появляется только после того, как он сам написал боту. Храним его по username.
// Карта «менеджер → chat id». Смотрим в трёх местах, потому что исторически
// их три: персональный ключ менеджера, общая карта username→chat
// и старый единственный слот manager_chat_id.
export async function getManagerChatMap() {
  const map = {};

  for (const username of MANAGER_USERNAMES) {
    const own = await kvGet(`manager_chat:${username}`);
    const fallback = await kvGet(`user_chat:${username}`);
    const id = own || fallback;
    if (id) map[username] = String(id);
  }

  return map;
}

export async function getManagerChatIds() {
  const ids = [];
  const map = await getManagerChatMap();

  for (const username of Object.keys(map)) {
    if (!ids.includes(map[username])) ids.push(map[username]);
  }

  // Старый глобальный слот: его перезаписывает каждый новый менеджер, нажавший /start,
  // поэтому он только дополнение, а не источник правды.
  const primary = await getManagerChatId();
  if (primary && !ids.includes(String(primary))) ids.push(String(primary));

  return ids;
}

export async function isManagerChat(chatId) {
  if (!chatId) return false;
  const ids = await getManagerChatIds();
  return ids.includes(String(chatId));
}

// Одно уведомление уходит всем менеджерам. Ошибка на одном чате не должна
// отменять доставку остальным — поэтому каждый вызов в своём try.
export async function notifyManagers(text, keyboard) {
  const ids = await getManagerChatIds();

  if (!ids.length) {
    console.warn('No manager chats known — notification skipped');
    return 0;
  }

  for (const id of ids) {
    try {
      await sendMessage(id, text, keyboard);
    } catch (e) {
      console.error('Manager notification failed for chat', id, e);
    }
  }

  return ids.length;
}
