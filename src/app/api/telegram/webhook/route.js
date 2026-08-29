import { NextResponse } from 'next/server';
import { clientTimeLine, clientDateLine, clientWhen, localTimeString, localSlot, slotKeyToDate } from '@/lib/time';
import { sendSchedule, sendTrialAttended } from '@/lib/meta';
import {
  getBooking, updateBooking, getBookedSlots, removeBookedSlot, addBookedSlot,
  setUserBooking, getUserBooking, clearUserBooking,
  getPendingBooking, clearPendingBooking,
  setManagerChatId, getManagerChatId,
  getAllActiveBookings, kvSet, kvGet, kvDel, kvKeys,
  createBooking, setPendingBooking
} from '@/lib/redis';
import {
  sendMessage, editMessage, answerCallback, forwardMessage,
  bookingActionsKeyboard, confirmCancelKeyboard, slotsKeyboard,
  managerActionsKeyboard, formatBookingConfirmation, formatBookingForManager,
  formatReminder, isManager, attendanceKeyboard, makeDeepLink, MANAGER_USERNAME,
  formatManagerCard
} from '@/lib/telegram';
import { notifyManagers, isManagerChat, getManagerChatIds } from '@/lib/managers';

// Verify webhook secret (optional extra security)
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// --- Available slots generation ---
function generateAvailableSlots(bookedSlots) {
  const slots = [];
  const now = new Date();
  const mskOffset = 3 * 60; // UTC+3

  // Горизонт записи три недели — столько же показывает воронка,
  // иначе при переносе человек видел бы меньше вариантов, чем при записи.
  for (let dayOffset = 0; dayOffset < 21; dayOffset++) {
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

// Короткий статус вместо повторного «Запись подтверждена!». Полное подтверждение
// человек уже получал при первой привязке, второе читается как новая запись.
function bookingStatusText(booking) {
  return `📋 <b>Ваша запись на месте</b>\n\n` +
    `${clientDateLine(booking)}\n${clientTimeLine(booking)}\n` +
    `📹 Формат: Пробный урок · 30 мин · Zoom\n\n` +
    `Ничего делать не нужно — ссылку на Zoom пришлём за час до начала.`;
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

    // У повторного клиента чат уже привязан к старой записи. Перепривязываем
    // только если найденная заявка новее той, что висит на чате.
    const currentId = await getUserBooking(chatId);
    if (currentId) {
      const current = await getBooking(currentId);
      if (current && current.status === 'confirmed' && String(current.createdAt || '') >= String(booking.createdAt || '')) return null;
    }

    await updateBooking(booking.id, { chatId: String(chatId) });
    await setUserBooking(chatId, booking.id);
    await clearPendingBooking(booking.id);
    const linked = { ...booking, chatId: String(chatId) };

    await sendMessage(chatId, formatBookingConfirmation(linked), bookingActionsKeyboard(booking.id));
    await fireSchedule(linked);

    await notifyManagers(formatBookingForManager(linked, 'new'));
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
      // Уже привязан к этому же чату — значит человек просто зашёл по ссылке снова
      const alreadyLinked = String(booking.chatId || '') === String(chatId);

      // Link chat to booking
      await updateBooking(bookingId, { chatId: String(chatId) });
      await setUserBooking(chatId, bookingId);
      await clearPendingBooking(bookingId);

      // Meta: запись подтверждена в боте
      await fireSchedule({ ...booking, chatId: String(chatId) });

      // Send confirmation to user
      await sendMessage(chatId,
        alreadyLinked ? bookingStatusText(booking) : formatBookingConfirmation(booking),
        bookingActionsKeyboard(bookingId)
      );
      // Note: manager notification is already sent by /api/book/route.js at booking time
      return;
    }

    // Токен с лендинга: заявки ещё нет, есть только идентификаторы клика. Заводим
    // запись без времени — время подберёт менеджер, а атрибуция уже привязана к человеку.
    const landing = await kvGet(`landing:${bookingId}`);
    if (landing) {
      const existing = landing.bookingId ? await getBooking(landing.bookingId) : null;
      if (existing) {
        // Повторный переход по той же ссылке: связка не одноразовая
        await updateBooking(existing.id, { chatId: String(chatId) });
        await setUserBooking(chatId, existing.id);
        await sendMessage(chatId, bookingStatusText({ ...existing, chatId: String(chatId) }), bookingActionsKeyboard(existing.id));
        return;
      }

      const handle = username ? '@' + username : '';
      const newId = generateBookingId();
      const landingBooking = {
        id: newId,
        name: handle || 'Заявка с лендинга',
        telegram: handle,
        email: '',
        slot: 'no_time',
        slotMsk: '',
        slotDate: '',
        slotLocal: '',
        chatId: String(chatId),
        status: 'confirmed',
        reminded24h: false,
        reminded1h: false,
        quizAnswers: {},
        attribution: landing.attribution || {},
        leadEventId: landing.leadEventId || '',
        tz: (landing.attribution && landing.attribution.tz) || '',
        createdAt: new Date().toISOString()
      };
      await createBooking(landingBooking);
      await setUserBooking(chatId, newId);
      await kvSet(`landing:${bookingId}`, { ...landing, bookingId: newId }, 90 * 24 * 60 * 60);

      await sendMessage(chatId, 'Здравствуйте! Заявка принята — менеджер школы напишет вам здесь и подберёт время пробного урока.\n\nМожно сразу написать, в какие дни и часы вам удобно.');

      await notifyManagers(formatBookingForManager(landingBooking, 'new'), managerActionsKeyboard(newId));
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
  // Ссылка открылась в старом чате — payload не пришёл, ищем заявку сами
  const linkedId = await linkByUsername(chatId, username);
  if (linkedId) return;

  const existingBookingId = await getUserBooking(chatId);
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
  await notifyManagers(formatBookingForManager(booking, 'cancel'));
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

// Перенос: одна механика для ученика и для менеджера, чтобы они не разъезжались.
async function applyNewSlot(bookingId, newSlotKey) {
  const booking = await getBooking(bookingId);
  if (!booking) return null;

  // Free old slot
  if (booking.slot && booking.slot !== 'no_time') {
    await removeBookedSlot(booking.slot);
  }

  await addBookedSlot(newSlotKey);

  const [dateStr, time] = newSlotKey.split('_');
  const slotDateObj = new Date(dateStr + 'T00:00:00');
  const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const newSlotDate = `${dayNames[slotDateObj.getDay()]}, ${slotDateObj.getDate()} ${monthNames[slotDateObj.getMonth()]}`;

  const updated = await updateBooking(bookingId, {
    slot: newSlotKey,
    slotMsk: time,
    slotDate: newSlotDate,
    slotLocal: localTimeString(booking, newSlotKey),
    reminded24h: false,
    reminded1h: false
  });

  if (updated) await fireSchedule(updated);

  return { booking, updated, newSlotDate };
}

function clientRescheduledText(booking, newSlotKey, newSlotDate) {
  return `Запись перенесена!\n\n` +
    `Новая дата: ${(localSlot(booking, newSlotKey) || {}).date || newSlotDate}\n` +
    `${clientTimeLine(booking, newSlotKey)}\n` +
    `Формат: Пробный урок · 30 мин · Zoom`;
}

async function handleNewSlot(chatId, bookingId, newSlotKey, callbackQueryId, messageId) {
  const result = await applyNewSlot(bookingId, newSlotKey);
  if (!result) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  const { booking, updated, newSlotDate } = result;
  await answerCallback(callbackQueryId, 'Запись перенесена!');

  // Кто нажал: сам ученик или менеджер за него. Во втором случае ученик
  // обязан узнать о новом времени — иначе он придёт к старому.
  const byManager = String(chatId) !== String(booking.chatId || '');

  if (byManager) {
    await editMessage(chatId, messageId,
      `🔄 Перенесено за ученика.\n\n` + formatManagerCard(updated || booking),
      managerActionsKeyboard(bookingId)
    );

    if (booking.chatId) {
      await sendMessage(booking.chatId,
        clientRescheduledText(booking, newSlotKey, newSlotDate),
        bookingActionsKeyboard(bookingId)
      );
    }
  } else {
    await editMessage(chatId, messageId,
      clientRescheduledText(booking, newSlotKey, newSlotDate),
      bookingActionsKeyboard(bookingId)
    );
  }

  if (updated) {
    await notifyManagers(formatBookingForManager(updated, 'reschedule'));
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
    `❌ Запись отменена менеджером.\n\n` +
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
  // К сетке добавляем ручной ввод: договорённости бывают вне расписания.
  const keyboard = slotsKeyboard(available, bookingId);
  keyboard.reply_markup.inline_keyboard.push([{ text: '✏️ Другое время', callback_data: `mgr_time:${bookingId}` }]);

  await sendMessage(chatId,
    `Перенос записи для: ${booking.name}\n` +
    `Текущее время: ${booking.slotDate || '—'}, ${booking.slotMsk || '—'} (МСК)\n\n` +
    `Выберите новое время:`,
    keyboard
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

// Менеджер отмечает, состоялся ли урок. Приход — то событие, на которое имеет смысл
// оптимизировать рекламу: запись без прихода алгоритму знать бесполезно.
async function handleAttendance(chatId, bookingId, attended, callbackQueryId, messageId) {
  const booking = await getBooking(bookingId);
  if (!booking) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  await updateBooking(bookingId, { attended, attendanceMarkedAt: new Date().toISOString() });

  if (attended && !booking.attendedSent) {
    try {
      const res = await sendTrialAttended({ ...booking, attended: true });
      if (res && res.ok) await updateBooking(bookingId, { attendedSent: true });
    } catch (e) {
      console.error('CAPI attended error:', e);
    }
  }

  await answerCallback(callbackQueryId, attended ? 'Отмечено: урок состоялся' : 'Отмечено: не пришёл');
  await editMessage(chatId, messageId,
    (attended ? '✅ Урок состоялся\n\n' : '🚫 Не пришёл\n\n') +
    `${booking.name || '—'} (${booking.telegram || booking.email || '—'})`
  );
}

// --- Пульт менеджера ---

// Расписание живёт в UTC+3, поэтому и «сегодня» считаем в нём:
// иначе вечерние уроки уезжают на другую дату.
function scheduleDayKey(daysAhead) {
  const shifted = new Date(Date.now() + 3 * 60 * 60 * 1000 + (daysAhead || 0) * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

async function sendBookingCards(chatId, bookings, title) {
  if (!bookings.length) {
    await sendMessage(chatId, `${title}: пусто.`);
    return;
  }

  await sendMessage(chatId, `<b>${title}</b> — ${bookings.length}`);

  for (const booking of bookings.slice(0, 20)) {
    await sendMessage(chatId, formatManagerCard(booking), managerActionsKeyboard(booking.id));
  }

  if (bookings.length > 20) {
    await sendMessage(chatId, `Показал первые 20 из ${bookings.length}.`);
  }
}

function bySlot(a, b) {
  return String(a.slot || '').localeCompare(String(b.slot || ''));
}

async function handleTodayCommand(chatId) {
  const today = scheduleDayKey(0);
  const all = await getAllActiveBookings();
  const list = all.filter(b => String(b.slot || '').slice(0, 10) === today).sort(bySlot);
  await sendBookingCards(chatId, list, 'Уроки сегодня');
}

async function handleBookingsCommand(chatId) {
  const from = scheduleDayKey(0);
  const to = scheduleDayKey(7);
  const all = await getAllActiveBookings();
  const list = all.filter(b => {
    const day = String(b.slot || '').slice(0, 10);
    return day >= from && day <= to;
  }).sort(bySlot);
  await sendBookingCards(chatId, list, 'Записи на ближайшую неделю');
}

// Поиск идёт по всем записям, включая отменённые: менеджеру часто нужна именно та,
// которую отменили по ошибке.
async function handleFindCommand(chatId, query) {
  const needle = String(query || '').trim().toLowerCase();

  if (needle.length < 2) {
    await sendMessage(chatId, 'Что искать? Например: /find оля или /find fkpvscvn');
    return;
  }

  const keys = await kvKeys('booking:*');
  const found = [];

  for (const key of keys) {
    const booking = await kvGet(key);
    if (!booking) continue;

    const haystack = [booking.id, booking.name, booking.telegram, booking.phone, booking.email]
      .filter(Boolean).join(' ').toLowerCase();

    if (haystack.includes(needle)) found.push(booking);
  }

  await sendBookingCards(chatId, found.sort(bySlot), `Найдено по «${needle}»`);
}

async function handleMgrWrite(chatId, bookingId, callbackQueryId) {
  const booking = await getBooking(bookingId);

  if (!booking) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  if (!booking.chatId) {
    await answerCallback(callbackQueryId, 'У ученика нет чата с ботом');
    return;
  }

  await answerCallback(callbackQueryId);
  await kvSet(`mgr_reply:${chatId}`, String(booking.chatId), 86400);
  await sendMessage(chatId,
    `Пишите сообщение — отправлю его ученику ${booking.name || ''}.\n` +
    '/done — закончить диалог.'
  );
}

// Менеджеру нужно ставить и время вне сетки: договорённости бывают любые.
async function handleMgrManualTimeAsk(chatId, bookingId, callbackQueryId) {
  const booking = await getBooking(bookingId);

  if (!booking) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  await answerCallback(callbackQueryId);
  await kvSet(`mgr_time:${chatId}`, bookingId, 3600);
  await sendMessage(chatId,
    `Новое время для: ${booking.name || '—'}\n` +
    `Сейчас: ${booking.slotDate || '—'}, ${booking.slotMsk || '—'} (МСК)\n\n` +
    'Пришлите дату и время: 03.09 15:30 — можно любое, вне сетки.\n' +
    '/cancel — выйти.'
  );
}

// Принимаем «03.09 15:30», «3.9.2026 15:30» и «2026-09-03 15:30».
function parseManualSlot(input) {
  const value = String(input || '').trim();

  let m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2})[:.](\d{2})$/);
  if (m) return buildSlotKey(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));

  m = value.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?\s+(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;

  const key = buildSlotKey(year, month, day, Number(m[4]), Number(m[5]));
  if (!key) return null;

  // Год не назвали, а дата уже прошла — значит имели в виду следующий год.
  if (!m[3] && new Date(`${key.slice(0, 10)}T00:00:00Z`).getTime() < Date.now() - 24 * 60 * 60 * 1000) {
    return buildSlotKey(year + 1, month, day, Number(m[4]), Number(m[5]));
  }

  return key;
}

function buildSlotKey(year, month, day, hour, minute) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

  const pad = n => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}_${pad(hour)}:${pad(minute)}`;
}

async function handleManagerManualTime(chatId, text) {
  const bookingId = await kvGet(`mgr_time:${chatId}`);
  if (!bookingId) return false;

  if (text === '/cancel' || text === '/done') {
    await kvDel(`mgr_time:${chatId}`);
    await sendMessage(chatId, 'Перенос отменён.');
    return true;
  }

  const slotKey = parseManualSlot(text);

  if (!slotKey) {
    await sendMessage(chatId,
      'Не разобрал время. Формат: 03.09 15:30 или 2026-09-03 15:30.\n' +
      '/cancel — выйти.'
    );
    return true;
  }

  await kvDel(`mgr_time:${chatId}`);
  const result = await applyNewSlot(bookingId, slotKey);

  if (!result) {
    await sendMessage(chatId, 'Запись не найдена.');
    return true;
  }

  const { booking, updated, newSlotDate } = result;

  await sendMessage(chatId,
    `🔄 Перенесено за ученика.\n\n` + formatManagerCard(updated || booking),
    managerActionsKeyboard(bookingId)
  );

  if (booking.chatId) {
    await sendMessage(booking.chatId,
      clientRescheduledText(booking, slotKey, newSlotDate),
      bookingActionsKeyboard(bookingId)
    );
  }

  if (updated) {
    await notifyManagers(formatBookingForManager(updated, 'reschedule'));
  }

  return true;
}

// --- Relay messages ---

async function handleRelayFromUser(chatId, message) {
  const relayBookingId = await kvGet(`relay:${chatId}`);
  if (!relayBookingId) return false;

  const booking = await getBooking(relayBookingId);
  const managerChatIds = await getManagerChatIds();

  if (!managerChatIds.length) {
    await sendMessage(chatId, 'Напишите менеджеру напрямую: @sayesstephanie');
    return true;
  }

  // Forward message to manager with context
  const header = `Сообщение от ${booking?.name || 'ученика'} (${booking?.telegram || ''}):\n` +
    `Запись: ${booking?.slotDate || '—'}, ${booking?.slotMsk || '—'} МСК\n` +
    `────────────────`;

  // Оба менеджера видят обращение, ответить может любой из них.
  for (const managerChatId of managerChatIds) {
    if (message.text) {
      await sendMessage(managerChatId, `${header}\n\n${message.text}`);
    } else {
      // Forward non-text messages directly
      await forwardMessage(managerChatId, chatId, message.message_id);
      await sendMessage(managerChatId, header);
    }

    // Store mapping for manager reply
    await kvSet(`mgr_reply:${managerChatId}`, String(chatId), 86400);
  }

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
        case 'mgr_time':
          await handleMgrManualTimeAsk(chatId, bookingId, callbackId);
          break;
        case 'mgr_write':
          await handleMgrWrite(chatId, bookingId, callbackId);
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
        case 'attended':
          await handleAttendance(chatId, bookingId, true, callbackId, messageId);
          break;
        case 'noshow':
          await handleAttendance(chatId, bookingId, false, callbackId, messageId);
          break;
        case 'pricing':
          await answerCallback(callbackId);
          await sendMessage(chatId,
            `💰 <b>Стоимость обучения SAY YES!</b>\n\n` +
            `<b>Онлайн-группы:</b> (8 занятий × 1,5 ч/мес)\n` +
            `• 1 мес — 140 EUR\n` +
            `• 3 мес — 370 EUR\n` +
            `• 6 мес — 650 EUR\n\n` +
            `<b>Пакеты с русскоязычным преподавателем</b> (1 занятие = 50 мин)\n` +
            `• 10 занятий — 210 EUR\n` +
            `• 20 занятий — 380 EUR\n` +
            `• 40 занятий — 690 EUR\n` +
            `• 60 занятий — 920 EUR\n\n` +
            `<b>Пакеты с носителем / спец-курс</b> (1 занятие = 50 мин)\n` +
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
        if (await isManagerChat(chatId)) {
          await handleBookCommand(chatId);
          return NextResponse.json({ ok: true });
        }
      }

      // Пульт менеджера: список записей, поиск и ручной ввод времени.
      if (await isManagerChat(chatId)) {
        if (await handleManagerManualTime(chatId, text || '')) {
          return NextResponse.json({ ok: true });
        }

        if (text === '/today') {
          await handleTodayCommand(chatId);
          return NextResponse.json({ ok: true });
        }

        if (text === '/bookings') {
          await handleBookingsCommand(chatId);
          return NextResponse.json({ ok: true });
        }

        if (text && text.startsWith('/find')) {
          await handleFindCommand(chatId, text.slice(5));
          return NextResponse.json({ ok: true });
        }

        if (text === '/help') {
          await sendMessage(chatId,
            '<b>Команды менеджера</b>\n' +
            '/today — уроки на сегодня\n' +
            '/bookings — записи на ближайшую неделю\n' +
            '/find запрос — поиск по имени, телефону, почте или коду\n' +
            '/book — записать ученика самому\n\n' +
            'На каждой карточке: перенести, отменить, отметить приход и написать ученику.'
          );
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
      if (!isManager(username)) {
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
      if (await isManagerChat(chatId)) {
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
