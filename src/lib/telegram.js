// Telegram Bot API helpers

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = 'SY_school_bot';
const MANAGER_USERNAME = process.env.MANAGER_TG_USERNAME || 'sayesstephanie';

function apiUrl(method) {
  return `https://api.telegram.org/bot${BOT_TOKEN()}/${method}`;
}

export async function sendMessage(chatId, text, options = {}) {
  try {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...options
    };
    const resp = await fetch(apiUrl('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await resp.json();
  } catch (e) {
    console.error('Telegram sendMessage error:', e);
    return null;
  }
}

export async function editMessage(chatId, messageId, text, options = {}) {
  try {
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      ...options
    };
    const resp = await fetch(apiUrl('editMessageText'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await resp.json();
  } catch (e) {
    console.error('Telegram editMessage error:', e);
    return null;
  }
}

export async function answerCallback(callbackQueryId, text) {
  try {
    await fetch(apiUrl('answerCallbackQuery'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text
      })
    });
  } catch (e) {
    console.error('Telegram answerCallback error:', e);
  }
}

export async function forwardMessage(chatId, fromChatId, messageId) {
  try {
    const resp = await fetch(apiUrl('forwardMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        from_chat_id: fromChatId,
        message_id: messageId
      })
    });
    return await resp.json();
  } catch (e) {
    console.error('Telegram forwardMessage error:', e);
    return null;
  }
}

// --- Inline keyboards ---

export function bookingActionsKeyboard(bookingId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'ÐÐµÑÐµÐ½ÐµÑÑÐ¸ Ð·Ð°Ð¿Ð¸ÑÑ', callback_data: `reschedule:${bookingId}` },
          { text: 'ÐÑÐ¼ÐµÐ½Ð¸ÑÑ Ð·Ð°Ð¿Ð¸ÑÑ', callback_data: `cancel:${bookingId}` }
        ],
        [
          { text: 'Ð¡Ð²ÑÐ·Ð°ÑÑÑÑ Ñ Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑÐ¾Ð¼', callback_data: `contact:${bookingId}` }
        ]
      ]
    }
  };
}

export function confirmCancelKeyboard(bookingId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'ÐÐ°, Ð¾ÑÐ¼ÐµÐ½Ð¸ÑÑ', callback_data: `confirm_cancel:${bookingId}` },
          { text: 'ÐÐµÑ, Ð¾ÑÑÐ°Ð²Ð¸ÑÑ', callback_data: `keep:${bookingId}` }
        ]
      ]
    }
  };
}

export function slotsKeyboard(slots, bookingId) {
  // slots: array of { key: "2026-06-15_11:00", label: "ÐÐ½, 15 Ð¸ÑÐ½ 11:00 (ÐÐ¡Ð)" }
  const rows = [];
  for (let i = 0; i < slots.length; i += 2) {
    const row = [{ text: slots[i].label, callback_data: `newslot:${bookingId}:${slots[i].key}` }];
    if (slots[i + 1]) {
      row.push({ text: slots[i + 1].label, callback_data: `newslot:${bookingId}:${slots[i + 1].key}` });
    }
    rows.push(row);
  }
  rows.push([{ text: 'ÐÑÐ¼ÐµÐ½Ð°', callback_data: `keep:${bookingId}` }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// --- Message formatting ---

export function formatBookingConfirmation(booking) {
  const timeInfo = booking.slot === 'no_time'
    ? 'ÐÑÐµÐ¼Ñ: Ð¿Ð¾Ð´Ð±ÐµÑÑÐ¼ Ð¿Ð¾Ð·Ð¶Ðµ'
    : `ÐÐ°ÑÐ°: ${booking.slotDate}\nÐÑÐµÐ¼Ñ (ÐÐ¡Ð): ${booking.slotMsk}`;

  return `ÐÐ°ÑÐ° Ð·Ð°Ð¿Ð¸ÑÑ Ð¿Ð¾Ð´ÑÐ²ÐµÑÐ¶Ð´ÐµÐ½Ð°!\n\n` +
    `${timeInfo}\n` +
    `Ð¤Ð¾ÑÐ¼Ð°Ñ: ÐÐ¾Ð½ÑÑÐ»ÑÑÐ°ÑÐ¸Ñ Â· 30 Ð¼Ð¸Ð½ Â· Zoom\n\n` +
    `ÐÑ ÑÐ²ÑÐ¶ÐµÐ¼ÑÑ Ñ Ð²Ð°Ð¼Ð¸ Ð² Ð±Ð»Ð¸Ð¶Ð°Ð¹ÑÐµÐµ Ð²ÑÐµÐ¼Ñ!`;
}

export function formatBookingForManager(booking, action = 'new') {
  const timeInfo = booking.slot === 'no_time'
    ? 'ÐÑÐµÐ¼Ñ: Ð½Ðµ Ð²ÑÐ±ÑÐ°Ð½Ð¾'
    : `ÐÐ°ÑÐ°: ${booking.slotDate}\nÐÑÐµÐ¼Ñ (ÐÐ¡Ð): ${booking.slotMsk}`;

  const icons = { new: 'ÐÐ¾Ð²Ð°Ñ Ð·Ð°ÑÐ²ÐºÐ°', cancel: 'ÐÑÐ¼ÐµÐ½Ð° Ð·Ð°Ð¿Ð¸ÑÐ¸', reschedule: 'ÐÐµÑÐµÐ½Ð¾Ñ Ð·Ð°Ð¿Ð¸ÑÐ¸' };
  const emoji = { new: 'ð', cancel: 'â', reschedule: 'ð' };

  return `${emoji[action]} ${icons[action]} SAY YES!\n\n` +
    `ÐÐ¼Ñ: ${booking.name}\n` +
    `Telegram: ${booking.telegram || 'â'}\n` +
    `Email: ${booking.email || 'â'}\n` +
    `${timeInfo}\n\n` +
    `ID: ${booking.id}`;
}

export function formatReminder(booking, hoursLeft) {
  const timeLabel = hoursLeft === 24 ? 'Ð·Ð°Ð²ÑÑÐ°' : 'ÑÐµÑÐµÐ· 1 ÑÐ°Ñ';
  return `ÐÐ°Ð¿Ð¾Ð¼Ð¸Ð½Ð°Ð½Ð¸Ðµ: Ð²Ð°ÑÐ° ÐºÐ¾Ð½ÑÑÐ»ÑÑÐ°ÑÐ¸Ñ ${timeLabel}!\n\n` +
    `ÐÐ°ÑÐ°: ${booking.slotDate}\n` +
    `ÐÑÐµÐ¼Ñ (ÐÐ¡Ð): ${booking.slotMsk}\n` +
    `Ð¤Ð¾ÑÐ¼Ð°Ñ: Zoom Â· 30 Ð¼Ð¸Ð½\n\n` +
    `ÐÑÐ»Ð¸ Ð½ÑÐ¶Ð½Ð¾ Ð¿ÐµÑÐµÐ½ÐµÑÑÐ¸ Ð¸Ð»Ð¸ Ð¾ÑÐ¼ÐµÐ½Ð¸ÑÑ, Ð½Ð°Ð¶Ð¼Ð¸ÑÐµ ÐºÐ½Ð¾Ð¿ÐºÑ Ð½Ð¸Ð¶Ðµ.`;
}

// --- Deep link ---

export function makeDeepLink(bookingId) {
  return `https://t.me/${BOT_USERNAME}?start=${bookingId}`;
}

// --- Check if user is manager ---

export function isManager(username) {
  if (!username) return false;
  return username.toLowerCase() === MANAGER_USERNAME.toLowerCase();
}

export { BOT_USERNAME, MANAGER_USERNAME };
