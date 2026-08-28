import { getManagerChatId, kvGet } from '@/lib/redis';
import { sendMessage, MANAGER_USERNAMES } from '@/lib/telegram';

// Telegram не даёт боту писать человеку первым, поэтому chat id менеджера
// появляется только после того, как он сам написал боту. Храним его по username.
export async function getManagerChatIds() {
  const ids = [];

  const primary = await getManagerChatId();
  if (primary) ids.push(String(primary));

  for (const username of MANAGER_USERNAMES) {
    const id = await kvGet(`user_chat:${username}`);
    if (id && !ids.includes(String(id))) ids.push(String(id));
  }

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
