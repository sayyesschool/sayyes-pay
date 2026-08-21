// Telegram Bot API helpers

import { clientTimeLine, clientDateLine, clientWhen, localSlot, tzLabel, tzNoteFor } from '@/lib/time';

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

export function managerActionsKeyboard(bookingId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔄 Перенести за ученика', callback_data: `mgr_reschedule:${bookingId}` },
          { text: '❌ Отменить за ученика', callback_data: `mgr_cancel:${bookingId}` }
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
  const firstName = booking.name ? booking.name.split(' ')[0] : '';
  const greeting = firstName ? `, ${firstName}` : '';

  // Время всегда в поясе клиента: он бронировал в своём, а не в базовом.
  // Пояса нет — считаем по CET и помечаем; базовый пояс школы клиенту не показываем.
  const timeInfo = (!booking.slot || booking.slot === 'no_time')
    ? '📅 Время: уточним с вами в ближайшее время'
    : `📅 ${clientDateLine(booking)}\n🕐 ${clientTimeLine(booking)}` +
      `\n🌍 Время указано ${tzNoteFor(booking)}`;

  return `✅ <b>Запись подтверждена${greeting}!</b>\n\n` +
    `${timeInfo}\n` +
    `📹 Формат: Пробный урок · 30 мин · Zoom\n\n` +
    `Ссылку на Zoom пришлём за час до начала.\n\n` +
    `<b>Важно:</b> Пробный урок — это знакомство со школой, преподавателем и нашей методикой обучения. Он будет полезен, если вы действительно рассматриваете изучение английского языка у нас.\n\n` +
    `Если ваша цель — просто посетить бесплатное занятие без намерения продолжать обучение, пожалуйста, отмените запись. Давайте бережно относиться ко времени друг друга — вашему и нашему. Спасибо за понимание!\n\n` +
    `Кнопки ниже — перенести, отменить или задать вопрос менеджеру 👇`;
}

export function formatBookingForManager(booking, action = 'new') {
  // Это сообщение видит только менеджер, поэтому здесь базовое время расписания.
  // Рядом — время клиента, чтобы не пересчитывать в уме перед звонком.
  const local = localSlot(booking);
  const timeInfo = booking.slot === 'no_time'
    ? 'Время: не выбрано'
    : `Дата: ${booking.slotDate}\nВремя (МСК): ${booking.slotMsk}` +
      (local && !local.assumed ? ` · у клиента ${local.time} (${tzLabel(booking)})` : '');

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
  // Показываем время в поясе клиента — он выбирал слот именно в нём.
  // Раньше здесь был slotMsk, из-за чего человек видел час, отличный от забронированного.
  return `Напоминание: ваш пробный урок ${timeLabel}!\n\n` +
    `${clientDateLine(booking)}\n` +
    `${clientTimeLine(booking)}\n` +
    `Формат: Zoom · 30 мин\n\n` +
    (hoursLeft === 1 ? `В конце урока преподаватель отдаст вам памятку «Как заговорить без стеснения».\n\n` : '') +
    `Если нужно перенести или отменить, нажмите кнопку ниже.`;
}

// Памятка «Как заговорить без стеснения» — отдельное касание перед уроком.
// Строкой внутри подтверждения она терялась среди дат и кнопок, поэтому уходит
// своим сообщением. Задача у него одна: довести человека до бесплатного урока.
export function formatHandout(booking) {
  const first = booking && booking.name ? String(booking.name).trim().split(' ')[0] : '';
  const opening = first ? first + ', ещё одно' : 'Ещё одно';
  return opening + ` — отдельным сообщением, чтобы не потерялось среди подтверждений.\n\n` +
    `Кроме разбора вашего уровня вы унесёте с урока памятку «Как заговорить без стеснения». Внутри:\n` +
    `— 5 приёмов, которые снимают языковой барьер\n` +
    `— 8 фраз, которые не дают разговору оборваться\n` +
    `— план на неделю: 10 минут в день, чтобы приёмы вошли в привычку\n\n` +
    `Всего 4 страницы — первое упражнение можно сделать в тот же вечер.\n\n` +
    `Отдельно мы её не рассылаем — памятку получают те, кто был на уроке. И преподаватель отметит прямо в ней, с каких приёмов начинать именно вам: после урока он уже будет знать, что именно мешает вам говорить.\n\n` +
    `Ваш урок: ${clientWhen(booking)}. Если планы поменялись — напишите сюда, перенесём на другое время.`;
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
