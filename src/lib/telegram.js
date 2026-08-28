import { ZOOM_JOIN_URL, ZOOM_MEETING_ID, ZOOM_PASSCODE } from '@/lib/zoom';
// Telegram Bot API helpers

import { clientTimeLine, clientDateLine, clientWhen, localSlot, tzLabel, tzNoteFor } from '@/lib/time';

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = 'SY_school_bot';
// Менеджеры: первый в списке — основной, остальные получают те же уведомления.
const MANAGER_USERNAMES = (
  process.env.MANAGER_TG_USERNAMES ||
  process.env.MANAGER_TG_USERNAME ||
  'sayesstephanie,sayyes_kristina'
)
  .split(',')
  .map(name => name.trim().replace(/^@/, '').toLowerCase())
  .filter(Boolean);
const MANAGER_USERNAME = MANAGER_USERNAMES[0];

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
    `🔗 <a href="${ZOOM_JOIN_URL}">Подключиться к уроку</a>\n` +
    `Идентификатор ${ZOOM_MEETING_ID}, код доступа ${ZOOM_PASSCODE}\n\n` +
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
    `Формат: Zoom · 30 мин\n` +
    `🔗 <a href="${ZOOM_JOIN_URL}">Подключиться к уроку</a>\n` +
    `Идентификатор ${ZOOM_MEETING_ID}, код доступа ${ZOOM_PASSCODE}\n\n` +
    (hoursLeft === 1 ? `После урока преподаватель соберёт для вас подборку материалов под вашу цель.\n\n` : '') +
    `Если нужно перенести или отменить, нажмите кнопку ниже.`;
}

// Касание перед уроком: напоминание плюс анонс бонуса. Отдельным сообщением, а не
// строкой в подтверждении — там его не замечали. Задача одна: довести до урока.
export function formatHandout(booking) {
  return `Ждём вас на уроке ${clientWhen(booking)}.\n\n` +
    `Во время пробного занятия преподаватель:\n` +
    `• определит ваш уровень и обозначит сильные стороны и области для развития\n` +
    `• познакомит вас с полезными разговорными конструкциями, которые вы сможете сразу использовать в речи\n` +
    `• составит план обучения под вашу цель: что подтянуть в первую очередь и в каком темпе двигаться\n\n` +
    `<b>💡 Бонус: после урока — подборка ресурсов под ваши цели: что смотреть, слушать и читать именно на вашем уровне. Преподаватель соберёт её лично для вас.</b>\n\n` +
    `🔗 <a href="${ZOOM_JOIN_URL}">Подключиться к уроку</a>\n` +
    `Идентификатор ${ZOOM_MEETING_ID}, код доступа ${ZOOM_PASSCODE}\n\n` +
    `Если планы изменятся, напишите нам или перенесите урок сами — кнопки ниже.\n\n` +
    `See you soon! Школа английского языка Say Yes! 💜`;
}

// Спросить менеджера, состоялся ли урок. Ответ становится событием TrialAttended:
// оптимизация на «записался» приводит тех, кто легко записывается и не доходит,
// поэтому Мете нужно знать именно про приход.
export function formatAttendanceAsk(booking) {
  return `❓ <b>Урок закончился</b>\n\n` +
    `Ученик: ${booking.name || '—'} (${booking.telegram || booking.email || '—'})\n` +
    `${clientDateLine(booking)}, ${clientTimeLine(booking)}\n\n` +
    `Отметьте, что произошло — это влияет на то, каких людей будет приводить реклама.`;
}

export function attendanceKeyboard(bookingId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Урок состоялся', callback_data: `attended:${bookingId}` },
          { text: '🚫 Не пришёл', callback_data: `noshow:${bookingId}` }
        ]
      ]
    }
  };
}

// --- Deep link ---

export function makeDeepLink(bookingId) {
  return `https://t.me/${BOT_USERNAME}?start=${bookingId}`;
}

// --- Check if user is manager ---

export function isManager(username) {
  if (!username) return false;
  return MANAGER_USERNAMES.includes(username.toLowerCase());
}

export { BOT_USERNAME, MANAGER_USERNAME, MANAGER_USERNAMES };
