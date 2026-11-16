import { getManagerChatId, kvGet } from '@/lib/redis';
import { sendMessage } from '@/lib/telegram';
import { managerUsernames, hostUsernames } from '@/lib/access';

// Telegram не даёт боту писать человеку первым, поэтому chat id менеджера
// появляется только после того, как он сам написал боту. Храним его по username.
// Карта «менеджер → chat id». Смотрим в трёх местах, потому что исторически
// их три: персональный ключ менеджера, общая карта username→chat
// и старый единственный слот manager_chat_id.
export async function getManagerChatMap() {
  const map = {};

  // Список менеджеров берётся из «Доступов» (право «Базовый» и супер-админы).
  for (const username of await managerUsernames()) {
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
  // С 31.10.2026 (раздел «Доступы») берём его, только если персональных чатов нет вовсе:
  // иначе удалённый из доступов человек, последним нажавший /start, продолжал бы получать заявки.
  const primary = await getManagerChatId();
  if (primary && !ids.length) ids.push(String(primary));

  return ids;
}

// Ведущие пробных уроков (17.11.2026: отдельная роль «Ведущий» в «Доступах»).
// Урок, у которого есть ведущий (booking.hostUsername), - только ему.
// Ведущего нет или его чат неизвестен - всем ведущим. Ни одного чата ведущих - менеджерам.
export async function hostChatId(username) {
  if (!username) return null;

  const name = String(username).replace(/^@/, '').toLowerCase();
  const id = (await kvGet(`manager_chat:${name}`)) || (await kvGet(`user_chat:${name}`));

  return id ? String(id) : null;
}

export async function notifyHost(text, keyboard, booking) {
  const own = booking && booking.hostUsername ? await hostChatId(booking.hostUsername) : null;
  const ids = [];

  if (own) {
    ids.push(own);
  } else {
    for (const username of await hostUsernames()) {
      const id = await hostChatId(username);

      if (id && !ids.includes(id)) ids.push(id);
    }
  }

  if (!ids.length) {
    console.warn('Trial host chats unknown');
    return notifyManagers(text, keyboard);
  }

  let sent = 0;

  // Ошибка на одном чате не должна отменять доставку остальным.
  for (const id of ids) {
    try {
      await sendMessage(id, text, keyboard);
      sent++;
    } catch (e) {
      console.error('Trial host notification failed for chat', id, e);
    }
  }

  return sent;
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

// Сообщение конкретным людям по username (например, супер-админам об изменении доступов).
export async function notifyUsers(usernames, text) {
  let sent = 0;

  for (const username of usernames || []) {
    const id = (await kvGet(`manager_chat:${username}`)) || (await kvGet(`user_chat:${username}`));

    if (!id) continue;

    try {
      await sendMessage(String(id), text);
      sent++;
    } catch (e) {
      console.error('notifyUsers error:', username, e);
    }
  }

  return sent;
}
