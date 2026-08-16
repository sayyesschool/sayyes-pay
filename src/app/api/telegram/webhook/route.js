import { NextResponse } from 'next/server';
import { clientTimeLine, clientDateLine, clientWhen, localTimeString, localSlot, slotKeyToDate } from '@/lib/time';
import { sendSchedule } from '@/lib/meta';
import {
  getBooking, updateBooking, getBookedSlots, removeBookedSlot, addBookedSlot,
  setUserBooking, getUserBooking, clearUserBooking,
  getPendingBooking, clearPendingBooking,
  setManagerChatId, getManagerChatId,
  getAllActiveBookings, kvSet, kvGet, kvDel,
  createBooking, setPendingBooking
} from '@/lib/redis';
import {
  sendMessage, editMessage, answerCallback, forwardMessage,
  bookingActionsKeyboard, confirmCancelKeyboard, slotsKeyboard,
  managerActionsKeyboard, formatBookingConfirmation, formatBookingForManager,
  formatReminder, isManager, makeDeepLink, MANAGER_USERNAME
} from '@/lib/telegram';

// Verify webhook secret (optional extra security)
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// --- Available slots generation ---
function generateAvailableSlots(bookedSlots) {
  const slots = [];
  const now = new Date();
  const mskOffset = 3 * 60; // UTC+3

  // Generate slots for next 14 days
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const date = new Date(now);
    date.setDate(date.getDate() + dayOffset);

    // Skip weekends
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;

    const dateStr = date.toISOString().split('T')[0]; // 2026-06-15

    // Slot times in MSK
    const times = ['10:30', '11:00', '11:30', '12:00', '13:00', '14:00',
                   '14:30', '15:00', '15:30', '16:00', '16:30', '17:00',
                   '17:30', '18:00', '18:30', '19:00', '19:30'];

    for (const time of times) {
      const slotKey = `${dateStr}_${time}`;
      if (bookedSlots.includes(slotKey)) continue;

      // Check if slot is in the future (at least 2 hours from now)
      const [h, m] = time.split(':').map(Number);
      const slotDate = new Date(date);
      slotDate.setUTCHours(h - 3, m, 0, 0); // Convert MSK to UTC
      if (slotDate - now < 2 * 60 * 60 * 1000) continue;

      // Format label
      const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
      const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
      const dayName = dayNames[date.getDay()];
      const monthName = monthNames[date.getMonth()];
      const label = `${dayName}, ${date.getDate()} ${monthName} ${time}`;

      slots.push({ key: slotKey, label });
    }
  }
  return slots.slice(0, 20); // Max 20 slots to show
}

// --- Command handlers ---

// Schedule для Meta — этап 2 оптимизации: человек дошёл до бота по своей ссылке
// и увидел подтверждение записи. Шлём один раз на заявку: повторный /start по той
// же ссылке не должен плодить события. Аналитика никогда не роняет обработчик.
async function fireSchedule(booking) {
  if (!booking || !booking.id || booking.scheduleSent) return;
  try {
    const extra = {};
    const date = slotKeyToDate(booking.slot);
    if (date) {
      extra.slotIso = date.toISOString();
      extra.hoursToLesson = Math.round((date.getTime() - Date.now()) / 3600000);
    }
    const res = await sendSchedule(booking, extra);
    if (res && res.ok) await updateBooking(booking.id, { scheduleSent: true });
  } catch (e) {
    console.error('CAPI schedule error:', e);
  }
}

// Телеграм-контакт из заявки и username в чате приводим к одному виду:
// «@Ivan», «ivan», «t.me/ivan» → «ivan».
function normHandle(value) {
  if (!value) return '';
  let s = String(value).trim().toLowerCase();
  const cut = s.lastIndexOf('/');
  if (cut >= 0) s = s.slice(cut + 1);
  if (s.startsWith('@')) s = s.slice(1);
  return s;
}

// Telegram отдаёт payload диплинка только при первом запуске чата: у того, кто
// когда-то уже писал боту, кнопки «Начать» нет, payload не приходит, и заявка
// остаётся без chat_id — ни подтверждения, ни напоминаний, ни Schedule.
// Поэтому при любом обращении непривязанного человека ищем его свежую заявку
// по username и связываем сами.
async function linkByUsername(chatId, username) {
  const handle = normHandle(username);
  if (!handle) return null;
  try {
    const all = await getAllActiveBookings();
    const mine = all
      .filter(b => b && b.id && !b.chatId && normHandle(b.telegram) === handle)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const booking = mine[0];
    if (!booking) return null;

    await updateBooking(booking.id, { chatId: String(chatId) });
    await setUserBooking(chatId, booking.id);
    await clearPendingBooking(booking.id);
    const linked = { ...booking, chatId: String(chatId) };

    await sendMessage(chatId, formatBookingConfirmation(linked), bookingActionsKeyboard(booking.id));
    await fireSchedule(linked);

    const managerChatId = await getManagerChatId();
    if (managerChatId) await sendMessage(managerChatId, formatBookingForManager(linked, 'new'));
    return booking.id;
  } catch (e) {
    console.error('linkByUsername error:', e);
    return null;
  }
}

async function handleStart(chatId, username, args) {
  // Check if manager
  if (isManager(username)) {
    await setManagerChatId(chatId);
    await sendMessage(chatId,
      'Вы зарегистрированы как менеджер SAY YES!\n\n' +
      'Вы будете получать уведомления о новых заявках, отменах и переносах.\n\n' +
      'Когда ученик напишет через бота, его сообщения будут пересылаться вам сюда. ' +
      'Ответьте на пересланное сообщение, и ваш ответ будет отправлен ученику.'
    );
    return;
  }

  // Deep link with booking ID
  if (args) {
    const bookingId = args;
    const booking = await getBooking(bookingId);

    if (booking) {
      // Link chat to booking
      await updateBooking(bookingId, { chatId: String(chatId) });
      await setUserBooking(chatId, bookingId);
      await clearPendingBooking(bookingId);

      // Meta: запись подтверждена в боте
      await fireSchedule({ ...booking, chatId: String(chatId) });

      // Send confirmation to user
      await sendMessage(chatId,
        formatBookingConfirmation(booking),
        bookingActionsKeyboard(bookingId)
      );
      // Note: manager notification is already sent by /api/book/route.js at booking time
      return;
    }

    // Booking not found - maybe expired
    await sendMessage(chatId,
      'Добро пожаловать в SAY YES! English School!\n\n' +
      'К сожалению, эта ссылка устарела. Пожалуйста, запишитесь заново на нашем сайте.\n\n' +
      'Если у вас есть активная запись, она появится здесь автоматически.'
    );
    return;
  }

  // Regular /start without deep link
  const existingBookingId = await getUserBooking(chatId);
  if (!existingBookingId) {
    // Ссылка открылась в старом чате — payload не пришёл, ищем заявку сами
    const linkedId = await linkByUsername(chatId, username);
    if (linkedId) return;
  }
  if (existingBookingId) {
    const booking = await getBooking(existingBookingId);
    if (booking && booking.status === 'confirmed') {
      await sendMessage(chatId,
        `Добро пожаловать в SAY YES! English School!\n\n` +
        `У вас есть активная запись:\n` +
        `${clientDateLine(booking)}\n` +
        `${clientTimeLine(booking)}\n\n` +
        `Что хотите сделать?`,
        bookingActionsKeyboard(existingBookingId)
      );
      return;
    }
  }

  await sendMessage(chatId,
    'Добро пожаловать в SAY YES! English School!\n\n' +
    'Чтобы записаться на бесплатную консультацию, перейдите на наш сайт:\n' +
    'https://www.sayyestoenglish.com/learn_easy\n\n' +
    'После записи вы получите подтверждение здесь.'
  );
}

async function handleCancel(chatId, bookingId, callbackQueryId) {
  const booking = await getBooking(bookingId);
  if (!booking || booking.status !== 'confirmed') {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  await answerCallback(callbackQueryId);
  await sendMessage(chatId,
    `Вы уверены, что хотите отменить запись?\n\n` +
    `${clientDateLine(booking)}\n${clientTimeLine(booking)}`,
    confirmCancelKeyboard(bookingId)
  );
}

async function handleConfirmCancel(chatId, bookingId, callbackQueryId, messageId) {
  const booking = await getBooking(bookingId);
  if (!booking) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  // Free the slot
  if (booking.slot && booking.slot !== 'no_time') {
    await removeBookedSlot(booking.slot);
  }

  // Update booking status
  await updateBooking(bookingId, { status: 'cancelled' });
  await clearUserBooking(chatId);

  await answerCallback(callbackQueryId, 'Запись отменена');
  await editMessage(chatId, messageId,
    'Ваша запись отменена.\n\n' +
    'Если захотите записаться снова:\nhttps://www.sayyestoenglish.com/learn_easy'
  );

  // Notify manager
  const managerChatId = await getManagerChatId();
  if (managerChatId) {
    await sendMessage(managerChatId, formatBookingForManager(booking, 'cancel'));
  }
}

async function handleReschedule(chatId, bookingId, callbackQueryId) {
  const booking = await getBooking(bookingId);
  if (!booking || booking.status !== 'confirmed') {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  await answerCallback(callbackQueryId);
  const rescheduleUrl = `https://www.sayyestoenglish.com/learn_easy?reschedule=${bookingId}`;
  await sendMessage(chatId,
    `🔄 <b>Перенос записи</b>\n\n` +
    `Текущее время: ${clientWhen(booking)}\n\n` +
    `Нажмите кнопку ниже, чтобы выбрать новое время в полном календаре:`,
    { reply_markup: { inline_keyboard: [
      [{ text: '📅 Выбрать новое время', url: rescheduleUrl }],
      [{ text: '↩️ Отмена', callback_data: `keep:${bookingId}` }]
    ]}}
  );
}

async function handleNewSlot(chatId, bookingId, newSlotKey, callbackQueryId, messageId) {
  const booking = await getBooking(bookingId);
  if (!booking) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  // Free old slot
  if (booking.slot && booking.slot !== 'no_time') {
    await removeBookedSlot(booking.slot);
  }

  // Book new slot
  await addBookedSlot(newSlotKey);

  // Parse new slot info
  const [dateStr, time] = newSlotKey.split('_');
  const slotDateObj = new Date(dateStr + 'T00:00:00');
  const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const newSlotDate = `${dayNames[slotDateObj.getDay()]}, ${slotDateObj.getDate()} ${monthNames[slotDateObj.getMonth()]}`;

  // Update booking
  const updated = await updateBooking(bookingId, {
    slot: newSlotKey,
    slotMsk: time,
    slotDate: newSlotDate,
    slotLocal: localTimeString(booking, newSlotKey),
    reminded24h: false,
    reminded1h: false
  });

  await answerCallback(callbackQueryId, 'Запись перенесена!');
  await editMessage(chatId, messageId,
    `Запись перенесена!\n\n` +
    `Новая дата: ${(localSlot(booking, newSlotKey) || {}).date || newSlotDate}\n` +
    `${clientTimeLine(booking, newSlotKey)}\n` +
    `Формат: Пробный урок · 30 мин · Zoom`,
    bookingActionsKeyboard(bookingId)
  );

  // Notify manager
  const managerChatId = await getManagerChatId();
  if (managerChatId && updated) {
    await sendMessage(managerChatId, formatBookingForManager(updated, 'reschedule'));
  }
}

async function handleMgrCancel(chatId, bookingId, callbackQueryId, messageId) {
  const booking = await getBooking(bookingId);
  if (!booking) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  // Free the slot
  if (booking.slot && booking.slot !== 'no_time') {
    await removeBookedSlot(booking.slot);
  }

  // Update booking status
  await updateBooking(bookingId, { status: 'cancelled' });

  await answerCallback(callbackQueryId, 'Запись отменена');
  await editMessage(chatId, messageId,
    `❌ Запись отменена менеджерои.\n\n` +
    `Ученик: ${booking.name} (${booking.telegram || '—'})\n` +
    `Дата: ${booking.slotDate || '—'}, ${booking.slotMsk || '—'} (МСК)`
  );

  // Notify student
  if (booking.chatId) {
    await sendMessage(booking.chatId,
      `Ваша запись была отменена менеджером.\n\n` +
      `Если хотите записаться снова:\nhttps://www.sayyestoenglish.com/learn_easy`
    );
  }
}

async function handleMgrReschedule(chatId, bookingId, callbackQueryId) {
  const booking = await getBooking(bookingId);
  if (!booking) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  const bookedSlots = await getBookedSlots();
  const available = generateAvailableSlots(bookedSlots);

  if (available.length === 0) {
    await answerCallback(callbackQueryId, 'Нет доступных слотов');
    return;
  }

  await answerCallback(callbackQueryId);
  await sendMessage(chatId,
    `Перенос записи для: ${booking.name}\n` +
    `Текущее время: ${booking.slotDate || '—'}, ${booking.slotMsk || '—'} (МСК)\n\n` +
    `Выберите новое время:`,
    slotsKeyboard(available, bookingId)
  );
}

async function handleContact(chatId, bookingId, callbackQueryId) {
  await answerCallback(callbackQueryId);

  // Store relay mode
  await kvSet(`relay:${chatId}`, bookingId);

  await sendMessage(chatId,
    'Напишите ваше сообщение, и мы передадим его менеджеру.\n\n' +
    'Менеджер ответит вам здесь, в этом чате.\n\n' +
    '<i>Чтобы выйти из режима связи, отправьте /cancel</i>'
  );
}

async function handleKeep(chatId, bookingId, callbackQueryId, messageId) {
  const booking = await getBooking(bookingId);
  await answerCallback(callbackQueryId, 'Хорошо, запись сохранена');

  if (booking) {
    await editMessage(chatId, messageId,
      formatBookingConfirmation(booking),
      bookingActionsKeyboard(bookingId)
    );
  }
}

// --- Manager /book command ---

function generateBookingId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

async function handleBookCommand(chatId) {
  const bookedSlots = await getBookedSlots();
  const available = generateAvailableSlots(bookedSlots);

  if (available.length === 0) {
    await sendMessage(chatId, 'Нет доступных слотов для записи.');
    return;
  }

  const rows = [];
  for (let i = 0; i < available.length; i += 2) {
    const row = [{ text: available[i].label, callback_data: `book_slot:${available[i].key}` }];
    if (available[i + 1]) row.push({ text: available[i + 1].label, callback_data: `book_slot:${available[i + 1].key}` });
    rows.push(row);
  }
  rows.push([{ text: '❌ Отмена', callback_data: 'book_cancel' }]);

  await sendMessage(chatId,
    '📅 <b>Запись клиента</b>\n\nВыберите время:',
    { reply_markup: { inline_keyboard: rows } }
  );
}

async function handleBookSlot(chatId, slotKey, callbackId, messageId) {
  const [dateStr, time] = slotKey.split('_');
  const slotDateObj = new Date(dateStr + 'T00:00:00');
  const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const slotDate = `${dayNames[slotDateObj.getDay()]}, ${slotDateObj.getDate()} ${monthNames[slotDateObj.getMonth()]}`;

  await kvSet(`mgr_booking:${chatId}`, JSON.stringify({ step: 'name', slot: slotKey, slotMsk: time, slotDate }), 1800);
  await answerCallback(callbackId);
  await editMessage(chatId, messageId,
    `📅 Выбрано: <b>${slotDate} в ${time} (МСК)</b>\n\nВведите имя клиента:`
  );
}

async function handleManagerBookingState(chatId, text) {
  const stateRaw = await kvGet(`mgr_booking:${chatId}`);
  if (!stateRaw) return false;

  let state;
  try { state = JSON.parse(stateRaw); } catch { return false; }

  if (state.step === 'name') {
    state.name = text;
    state.step = 'contact';
    await kvSet(`mgr_booking:${chatId}`, JSON.stringify(state), 1800);
    await sendMessage(chatId, `Имя: <b>${text}</b>\n\nВведите Telegram-ник или номер телефона клиента:`);
    return true;
  }

  if (state.step === 'contact') {
    const { name, slot, slotMsk, slotDate } = state;
    const contact = text;

    const bookedSlots = await getBookedSlots();
    if (bookedSlots.includes(slot)) {
      await kvDel(`mgr_booking:${chatId}`);
      await sendMessage(chatId, '❌ Это время уже занято. Начните заново: /book');
      return true;
    }

    await addBookedSlot(slot);

    const bookingId = generateBookingId();
    const booking = {
      id: bookingId, name, telegram: contact, email: '',
      slot, slotMsk, slotDate, slotLocal: '',
      chatId: null, status: 'confirmed',
      reminded24h: false, reminded1h: false,
      quizAnswers: {}, createdAt: new Date().toISOString()
    };

    await createBooking(booking);
    await setPendingBooking(bookingId, booking);
    await kvDel(`mgr_booking:${chatId}`);

    const botLink = makeDeepLink(bookingId);
    await sendMessage(chatId,
      `✅ <b>Клиент записан!</b>\n\n` +
      `Имя: ${name}\nКонтакт: ${contact}\n` +
      `Дата: ${slotDate}\nВремя (МСК): ${slotMsk}\n\n` +
      `Отправьте клиенту ссылку:\n${botLink}`,
      { reply_markup: { inline_keyboard: [[{ text: '🔗 Открыть ссылку', url: botLink }]] } }
    );
    return true;
  }

  return false;
}

// --- Relay messages ---

async function handleRelayFromUser(chatId, message) {
  const relayBookingId = await kvGet(`relay:${chatId}`);
  if (!relayBookingId) return false;

  const booking = await getBooking(relayBookingId);
  const managerChatId = await getManagerChatId();

  if (!managerChatId) {
    await sendMessage(chatId, 'Напишите менеджеру напрямую: @sayesstephanie');
    return true;
  }

  // Forward message to manager with context
  const header = `Сообщение от ${booking?.name || 'ученика'} (${booking?.telegram || ''}):\n` +
    `Запись: ${booking?.slotDate || '—'}, ${booking?.slotMsk || '—'} МСК\n` +
    `────────────────`;

  if (message.text) {
    await sendMessage(managerChatId, `${header}\n\n${message.text}`);
  } else {
    // Forward non-text messages directly
    await forwardMessage(managerChatId, chatId, message.message_id);
    await sendMessage(managerChatId, header);
  }

  // Store mapping for manager reply
  await kvSet(`mgr_reply:${managerChatId}`, String(chatId), 86400);

  await sendMessage(chatId,
    'Сообщение отправлено менеджеру. Ожидайте ответа.\n\n' +
    '<i>Отправьте /done чтобы закончить диалог</i>'
  );
  return true;
}

async function handleRelayFromManager(managerChatId, message) {
  // Check if manager is replying to a user
  const targetChatId = await kvGet(`mgr_reply:${managerChatId}`);
  if (!targetChatId) return false;

  if (message.text) {
    await sendMessage(targetChatId, `Ответ менеджера:\n\n${message.text}`);
  } else {
    await forwardMessage(targetChatId, managerChatId, message.message_id);
  }

  await sendMessage(managerChatId, 'Ответ отправлен ученику.');
  return true;
}

// --- Main webhook handler ---

export async function POST(request) {
  try {
    // Optional: verify webhook secret
    if (WEBHOOK_SECRET) {
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (secret !== WEBHOOK_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const update = await request.json();

    // Handle callback queries (inline keyboard buttons)
    if (update.callback_query) {
      const { id: callbackId, data, message, from } = update.callback_query;
      const chatId = message.chat.id;
      const messageId = message.message_id;

      const [action, ...params] = data.split(':');
      const bookingId = params[0];

      switch (action) {
        case 'cancel':
          await handleCancel(chatId, bookingId, callbackId);
          break;
        case 'confirm_cancel':
          await handleConfirmCancel(chatId, bookingId, callbackId, messageId);
          break;
        case 'reschedule':
          await handleReschedule(chatId, bookingId, callbackId);
          break;
        case 'newslot':
          const newSlot = params.slice(1).join(':'); // rejoin in case time has ':'
          await handleNewSlot(chatId, bookingId, newSlot, callbackId, messageId);
          break;
        case 'book_slot':
          const bookSlotKey = params.join(':'); // rejoin for colon in time
          await handleBookSlot(chatId, bookSlotKey, callbackId, messageId);
          break;
        case 'book_cancel':
          await answerCallback(callbackId, 'Отменено');
          await editMessage(chatId, messageId, 'Запись клиента отменена.');
          break;
        case 'mgr_cancel':
          await handleMgrCancel(chatId, bookingId, callbackId, messageId);
          break;
        case 'mgr_reschedule':
          await handleMgrReschedule(chatId, bookingId, callbackId);
          break;
        case 'contact':
          await handleContact(chatId, bookingId, callbackId);
          break;
        case 'keep':
          await handleKeep(chatId, bookingId, callbackId, messageId);
          break;
        case 'pricing':
          await answerCallback(callbackId);
          await sendMessage(chatId,
            `💰 <b>Стоимость обучения SAY YES!</b>\n\n` +
            `<b>Онлайн-групп�</b> (8 занятий × 1,5 ч/мес)\n` +
            `• 1 мес — 140 EUR\n` +
            `• 3 мес — 370 EUR\n` +
            `• 6 мес — 650 EUR\n\n` +
            `<b>Пакеты с русскоязычным преподавателем</b> (1 занятие= 50 мин)\n` +
            `• 5 занятий — 102 EUR\n` +
            `• 10 занятий — 175 EUR\n` +
            `• 20 занятий — 315 EUR\n` +
            `• 40 занятий — 540 EUR\n` +
            `• 60 занятий — 740 EUR\n\n` +
            `<b>Пакеты с носителем / спец-курс</b> (1 занятие= 50 мин)\n` +
            `• 5 занятий — 150 EUR\n` +
            `• 10 занятий — 255 EUR\n` +
            `• 20 занятий — 460 EUR\n` +
            `• 40 занятий — 850 EUR\n` +
            `• 60 занятий — 1 150 EUR`,
            bookingId ? bookingActionsKeyboard(bookingId) : {}
          );
          break;
        default:
          await answerCallback(callbackId);
      }
      return NextResponse.json({ ok: true });
    }

    // Handle messages
    if (update.message) {
      const { chat, text, from } = update.message;
      const chatId = chat.id;
      const username = from?.username;

      // Save username→chatId mapping for daily summaries
      if (username) {
        await kvSet(`user_chat:${username.toLowerCase()}`, String(chatId));
      }

      // Command: /book (manager only)
      if (text === '/book') {
        const mgrChatId = await getManagerChatId();
        if (String(chatId) === String(mgrChatId)) {
          await handleBookCommand(chatId);
          return NextResponse.json({ ok: true });
        }
      }

      // Command: /start
      if (text?.startsWith('/start')) {
        const args = text.split(' ')[1]; // deep link parameter
        await handleStart(chatId, username, args);
        return NextResponse.json({ ok: true });
      }

      // Command: /done or /cancel (exit relay mode)
      if (text === '/done' || text === '/cancel') {
        const relayActive = await kvGet(`relay:${chatId}`);
        if (relayActive) {
          await kvDel(`relay:${chatId}`);
          const bookingId = await getUserBooking(chatId);
          if (bookingId) {
            const booking = await getBooking(bookingId);
            if (booking && booking.status === 'confirmed') {
              await sendMessage(chatId,
                'Диалог с менеджером завершён.\n\nВаша запись:',
              );
              await sendMessage(chatId,
                formatBookingConfirmation(booking),
                bookingActionsKeyboard(bookingId)
              );
              return NextResponse.json({ ok: true });
            }
          }
          await sendMessage(chatId, 'Диалог с менеджером завершён.');
          return NextResponse.json({ ok: true });
        }
        // If no relay active, treat as regular message
      }

      // Command: /myrecord - show current booking
      if (text === '/myrecord' || text === '/mybooking') {
        const bookingId = await getUserBooking(chatId);
        if (bookingId) {
          const booking = await getBooking(bookingId);
          if (booking && booking.status === 'confirmed') {
            await sendMessage(chatId,
              formatBookingConfirmation(booking),
              bookingActionsKeyboard(bookingId)
            );
            return NextResponse.json({ ok: true });
          }
        }
        await sendMessage(chatId,
          'У вас нет активных записей.\n\n' +
          'Записаться: https://www.sayyestoenglish.com/learn_easy'
        );
        return NextResponse.json({ ok: true });
      }

      // Запасной путь для тех, у кого чат с ботом уже был: payload диплинка Telegram
      // им не отправляет. Сначала пробуем связать по username, затем принимаем код
      // заявки, отправленный текстом.
      if (!isManager(username) && !(await getUserBooking(chatId))) {
        const autoLinkedId = await linkByUsername(chatId, username);
        if (autoLinkedId) return NextResponse.json({ ok: true });

        const typed = (text || '').trim().toLowerCase();
        const code = typed.startsWith('/') ? typed.slice(1) : typed;
        const isCode = code.length === 8 && [...code].every(ch => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'));
        if (isCode && await getBooking(code)) {
          await handleStart(chatId, username, code);
          return NextResponse.json({ ok: true });
        }
      }

      // Check if this is a relay message from user
      const relayHandled = await handleRelayFromUser(chatId, update.message);
      if (relayHandled) return NextResponse.json({ ok: true });

      // Check if manager is in booking flow or replying
      const managerChatIdStored = await getManagerChatId();
      if (String(chatId) === String(managerChatIdStored)) {
        const bookingHandled = await handleManagerBookingState(chatId, text || '');
        if (bookingHandled) return NextResponse.json({ ok: true });

        const relayFromMgr = await handleRelayFromManager(chatId, update.message);
        if (relayFromMgr) return NextResponse.json({ ok: true });
      }

      // Default response for unknown messages
      const bookingId = await getUserBooking(chatId);
      if (bookingId) {
        const booking = await getBooking(bookingId);
        if (booking && booking.status === 'confirmed') {
          await sendMessage(chatId,
            'У вас есть активная запись. Что хотите сделать?',
            bookingActionsKeyboard(bookingId)
          );
          return NextResponse.json({ ok: true });
        }
      }

      await sendMessage(chatId,
        'Чтобы записаться на бесплатную консультацию:\n' +
        'https://www.sayyestoenglish.com/learn_easy\n\n' +
        'Команды:\n/myrecord — показать вашу запись'
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Webhook error:', e);
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram
  }
}

// GET handler for webhook verification
export async function GET() {
  return NextResponse.json({ status: 'Bot webhook is active' });
}
