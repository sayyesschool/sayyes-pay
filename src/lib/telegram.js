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
          { text: 'Перенести запись', callback_data: `reschedule:${bookingId}` },
          { text: 'Отменить запись', callback_data: `cancel:${bookingId}` }
        ],
        [
          { text: 'Связаться с менеджером', callback_data: `contact:${bookingId}` }
        ],
        [
          { text: '💰 Посмотреть стоимость обучения', callback_data: `pricing:${bookingId}` }
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
          { text: 'Да, отменить', callback_data: `confirm_cancel:${bookingId}` },
          { text: 'Нет, оставить', callback_data: `keep:${bookingId}` }
        ]
      ]
    }
  };
}

export function slotsKeyboard(slots, bookingId) {
  // slots: array of { key: "2026-06-15_11:00", label: "Пн, 15 июн 11:00 (МСК)" }
  const rows = [];
  for (let i = 0; i < slots.length; i += 2) {
    const row = [{ text: slots[i].label, callback_data: `newslot:${bookingId}:${slots[i].key}` }];
    if (slots[i + 1]) {
      row.push({ text: slots[i + 1].label, callback_data: `newslot:${bookingId}:${slots[i + 1].key}` });
    }
    rows.push(row);
  }
  rows.push([{ text: 'Отмена', callback_data: `keep:${bookingId}` }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// --- Message formatting ---

export function formatBookingConfirmation(booking) {
  const timeInfo = (!booking.slot || booking.slot === 'no_time')
    ? 'Время: подберём позже'
    : `Дата: ${booking.slotDate || '—'}\nВремя (МСК): ${booking.slotMsk || '—'}`;

  return `Ваша запись подтверждена!\n\n` +
    `${timeInfo}\n` +
    `Формат: Консультация · 30 мин · Zoom\n\n` +
    `Мы свяжемся с вами в ближайшее время!`;
}

export function formatBookingForManager(booking, action = 'new') {
  const timeInfo = booking.slot === 'no_time'
    ? 'Время: не выбрано'
    : `Дата: ${booking.slotDate}\nВремя (МСК): ${booking.slotMsk}`;

  const icons = { new: 'Новая заявка', cancel: 'Отмена записи', reschedule: 'Перенос записи' };
  const emoji = { new: '📝', cancel: '❌', reschedule: '🔄' };

  let answersText = '';
  if (booking.quizAnswers && Object.keys(booking.quizAnswers).length > 0) {
    answersText = '\n\n📋 <b>Ответы на вопросы:</b>\n' +
      Object.entries(booking.quizAnswers)
        .map(([q, a]) => `• ${q}: ${a}`)
        .join('\n');
  }

  return `${emoji[action]} ${icons[action]} SAY YES!\n\n` +
    `Имя: ${booking.name}\n` +
    `Telegram: ${booking.telegram || '—'}\n` +
    `Email: ${booking.email || '—'}\n` +
    `${timeInfo}` +
    `${answersText}\n\n` +
    `ID: ${booking.id}`;
}

export function formatReminder(booking, hoursLeft) {
  const timeLabel = hoursLeft === 24 ? 'завтра' : 'через 1 час';
  return `Напоминание: ваша консультация ${timeLabel}!\n\n` +
    `Дата: ${booking.slotDate}\n` +
    `Время (МСК): ${booking.slotMsk}\n` +
    `Формат: Zoom · 30 мин\n\n` +
    `Если нужно перенести или отменить, нажмите кнопку ниже.`;
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
