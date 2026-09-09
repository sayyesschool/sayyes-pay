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

// Ведущие пробных уроков. Им уходит карточка клиента перед звонком:
// остальным этот шум не нужен. Уроки ведёт не один человек, поэтому список,
// а не единственный username. Меняется переменной окружения.
export const TRIAL_HOST_USERNAMES = (
  process.env.TRIAL_HOST_USERNAMES ||
  process.env.TRIAL_HOST_USERNAME ||
  'sayyes_kristina,sayyes_roman,sayesstephanie'
)
  .split(',')
  .map(name => name.trim().replace(/^@/, '').toLowerCase())
  .filter(Boolean);

// Первый в списке — на случай, если где-то нужно одно имя.
export const TRIAL_HOST_USERNAME = TRIAL_HOST_USERNAMES[0];

// Сообщение ведущим. Если ничей чат боту неизвестен (никто не нажимал «Начать»),
// молчать нельзя — так уже терялись уведомления. Тогда шлём всем менеджерам.
export async function notifyHost(text, keyboard) {
  const map = await getManagerChatMap();
  const ids = [];

  for (const username of TRIAL_HOST_USERNAMES) {
    const id = map[username];

    if (id && !ids.includes(id)) ids.push(id);
  }

  if (!ids.length) {
    console.warn('Trial host chats unknown:', TRIAL_HOST_USERNAMES.join(','));
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
