import { NextResponse } from 'next/server';
import { getProducts } from '@/services/stripe';
import { getIntroProducts, getIntroProduct, introActive, introExpiry, nextIntroExpiry } from '@/services/intro';
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
  formatReminder, isManager, attendanceKeyboard, makeDeepLink, MANAGER_USERNAME, MANAGER_USERNAMES,
  formatManagerCard
} from '@/lib/telegram';
import { notifyManagers, isManagerChat, getManagerChatIds, getManagerChatMap } from '@/lib/managers';

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
    // Персональный ключ: раньше был один общий слот, и каждый новый
    // менеджер выталкивал из уведомлений предыдущего.
    await kvSet(`manager_chat:${String(username).toLowerCase()}`, String(chatId));
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
    reminded1h: false,
    // Урок переехал — карточка ведущей должна прийти заново перед новым временем.
    hostBriefed: false
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
async function handleAttendance(chatId, bookingId, attended, callbackQueryId, messageId, from) {
  const booking = await getBooking(bookingId);
  if (!booking) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  // Отсчёт спецпредложения начинается здесь: трое суток с момента,
  // когда урок отметили состоявшимся.
  // Повторное нажатие «Пришёл» не должно молча продлевать спецпредложение,
  // а «Не пришёл» обязан его закрыть: оффер — за состоявшийся урок.
  const introPatch = attended
    ? (booking.introExpiresAt ? {} : { introExpiresAt: nextIntroExpiry() })
    : { introExpiresAt: null };

  // Кто нажал — раньше не сохранялось нигде, и вопрос «кто отметил?»
  // оставался без ответа.
  const markedBy = from && from.username ? '@' + from.username : (from && from.first_name) || null;

  await updateBooking(bookingId, {
    attended,
    attendanceMarkedAt: new Date().toISOString(),
    attendedBy: markedBy,
    ...introPatch
  });

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

  // Напоминание, а не автоотправка: формат выбирает ведущая,
  // она только что говорила с человеком.
  if (attended) {
    await sendMessage(
      chatId,
      '🎁 Спецпредложение для этого ученика активно трое суток. Отправить — кнопкой ниже.',
      { inline_keyboard: [[{ text: '💳 Ссылка на оплату', callback_data: `mgr_pay:${bookingId}` }]] }
    );
  }
}

// --- Пульт менеджера ---

// Сводка по заявкам считается по базе, а не по событиям Меты: в пикселе Lead
// дублируется браузером и сервером, поэтому как счётчик людей он не годится.
// Заявки без выбранного времени не попадают ни в /today, ни в /bookings —
// там фильтр по дате слота. Без отдельной команды они просто теряются.
async function handlePendingCommand(chatId) {
  const all = await getAllActiveBookings();
  const list = all.filter(b => !b.slot || b.slot === 'no_time');

  list.sort((a, b) => String(b.createdAt || 0).localeCompare(String(a.createdAt || 0)));
  await sendBookingCards(chatId, list, 'Ждут подбора времени');
}

// Границы суток считаем в базовом поясе расписания (UTC+3) — том же,
// в котором живёт «сегодня» у /today. Иначе вечерние заявки уезжают в соседний день.
function statsWindow(text) {
  const parts = String(text || '').trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const day = 24 * 60 * 60 * 1000;
  const shift = 3 * 60 * 60 * 1000;
  const startOfToday = Math.floor((Date.now() + shift) / day) * day - shift;

  if (command === '/stats_today') {
    return { from: startOfToday, to: Date.now(), label: 'сегодня' };
  }

  if (command === '/stats_yesterday') {
    return { from: startOfToday - day, to: startOfToday, label: 'вчера' };
  }

  const days = Math.min(Math.max(parseInt(parts[1], 10) || 7, 1), 90);
  return { from: Date.now() - days * day, to: Date.now(), label: `за ${days} дн.` };
}

// Кто из менеджеров реально получает уведомления. Без этой команды
// молчание бота у конкретного человека никак не видно со стороны.
async function handleWhoCommand(chatId) {
  const map = await getManagerChatMap();
  const lines = MANAGER_USERNAMES.map(username => {
    const id = map[username];
    return `${id ? '✅' : '⛔️'} @${username}${id ? '' : ' — не нажал «Начать», уведомления не идут'}`;
  });

  await sendMessage(chatId,
    '<b>Кому бот шлёт уведомления</b>\n\n' + lines.join('\n') +
    '\n\nЧтобы появиться в списке, достаточно отправить боту любое сообщение.'
  );
}

async function handleStatsCommand(chatId, text) {
  const { from, to, label } = statsWindow(text);

  const keys = await kvKeys('booking:*');
  const bookings = [];

  for (const key of keys) {
    const booking = await kvGet(key);
    if (!booking || !booking.createdAt) continue;
    // Архив — это заявки до запуска рекламы. Они портили доходимость
    // фальшивыми отметками «пришёл» из старого бага.
    if (booking.archived) continue;
    const created = new Date(booking.createdAt).getTime();
    if (created < from || created >= to) continue;
    bookings.push(booking);
  }

  if (!bookings.length) {
    await sendMessage(chatId, `Заявок ${label} нет.`);
    return;
  }

  const hasSlot = b => b.slot && b.slot !== 'no_time';
  const gaps = [];

  for (const booking of bookings) {
    if (!hasSlot(booking)) continue;
    const [dateStr, time] = String(booking.slot).split('_');
    const [h, m] = String(time).split(':').map(Number);
    // Ключ слота — в базовом поясе расписания (UTC+3), поэтому минус три часа.
    const slotUtc = new Date(`${dateStr}T00:00:00Z`);

    if (Number.isNaN(slotUtc.getTime())) continue;

    slotUtc.setTime(slotUtc.getTime() + ((h - 3) * 60 + m) * 60 * 1000);
    const gap = (slotUtc.getTime() - new Date(booking.createdAt).getTime()) / 3600000;
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
  }

  const total = bookings.length;
  const openedBot = bookings.filter(b => b.chatId).length;
  const cancelled = bookings.filter(b => b.status === 'cancelled').length;
  const noTime = bookings.filter(b => !hasSlot(b)).length;
  const attended = bookings.filter(b => b.attended === true).length;
  const noShow = bookings.filter(b => b.attended === false).length;
  const marked = attended + noShow;
  const share = n => Math.round((n / total) * 100);
  const avgGap = gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null;

  await sendMessage(chatId,
    `<b>Заявки ${label}</b>\n\n` +
    `Всего: ${total}\n` +
    `Открыли бота: ${openedBot} (${share(openedBot)}%)\n` +
    `Без бота: ${total - openedBot}\n` +
    `Без выбранного времени: ${noTime}\n` +
    `Отменено: ${cancelled}\n\n` +
    `Пришли: ${attended}\n` +
    `Не пришли: ${noShow}\n` +
    `Не отмечено: ${total - marked}\n\n` +
    (avgGap === null ? '' : `Средний разрыв заявка → урок: ${avgGap} ч\n`) +
    `<i>Считается по базе записей.</i>`
  );

  // Цифра «пришли: 1» без имени бесполезна — сразу показываем, кто это и кто отметил.
  const named = list => list
    .map(b => `• ${b.name || 'без имени'} · <code>${b.id}</code>${b.attendedBy ? ' · отметил(а) ' + b.attendedBy : ''}`)
    .join('\n');

  const attendedList = bookings.filter(b => b.attended === true);
  const noShowList = bookings.filter(b => b.attended === false);

  if (attendedList.length || noShowList.length) {
    await sendMessage(chatId,
      (attendedList.length ? `<b>Пришли</b>\n${named(attendedList)}\n\n` : '') +
      (noShowList.length ? `<b>Не пришли</b>\n${named(noShowList)}` : '')
    );
  }
}



// Заявки до запуска рекламы мешают считать доходимость: там тесты и фальшивые
// отметки «пришёл» из бага с кнопкой «Отмена». Не удаляем — прячем: данные
// остаются в /find, но выпадают из /stats и сводки.
const ARCHIVE_BEFORE = process.env.ARCHIVE_BEFORE || '2026-08-28T16:00:00Z';

async function handleCleanupCommand(chatId, text) {
  const mode = String(text || '').trim().split(/\s+/)[1] || '';
  const before = new Date(ARCHIVE_BEFORE).getTime();
  const keys = await kvKeys('booking:*');
  const found = [];

  for (const key of keys) {
    const booking = await kvGet(key);

    if (!booking) continue;

    if (mode === 'undo') {
      if (booking.archived) found.push(booking);
      continue;
    }

    if (booking.archived) continue;

    const created = booking.createdAt ? new Date(booking.createdAt).getTime() : 0;

    if (!created || created >= before) continue;

    found.push(booking);
  }

  if (mode === 'undo') {
    for (const booking of found) await updateBooking(booking.id, { archived: false });
    await sendMessage(chatId, `Вернул из архива: ${found.length}.`);
    return;
  }

  if (!found.length) {
    await sendMessage(chatId, 'Старых заявок не нашлось — база уже чистая.');
    return;
  }

  const lines = found.slice(0, 30).map(booking =>
    `• ${booking.name || 'без имени'} · <code>${booking.id}</code> · ${booking.slotDate || 'без времени'}` +
    (booking.attended === true ? ' · отмечен «пришёл»' : '')
  );

  if (mode !== 'yes') {
    await sendMessage(chatId,
      `<b>В архив пойдёт: ${found.length}</b>\nВсё, что создано до ${new Date(before).toLocaleDateString('ru-RU')}.\n\n` +
      lines.join('\n') +
      (found.length > 30 ? `\n… и ещё ${found.length - 30}` : '') +
      '\n\nЭти заявки пропадут из /stats и дневной сводки, но останутся в /find.\n' +
      'Применить: /cleanup yes\nВернуть обратно: /cleanup undo'
    );
    return;
  }

  for (const booking of found) await updateBooking(booking.id, { archived: true });

  await sendMessage(chatId, `Готово: в архив отправлено ${found.length}. Вернуть — /cleanup undo.`);
}

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

// Ссылка на оплату с кодом записи. Без кода оплата искалась по совпадению почты
// и терялась, если человек платил с другого адреса.
// Прайс для меню тянется из Stripe — того же источника, что и страница оплаты.
// Жёсткий список в боте разъехался бы с прайсом при первом же изменении цен.
async function loadPriceGroups() {
  const products = await getProducts({ limit: 100, active: true });
  const groups = [];

  for (const product of products) {
    let group = groups.find(item => item.id === product.group_id);

    if (!group) {
      group = { id: product.group_id, name: product.name, items: [] };
      groups.push(group);
    }

    group.items.push(product);
  }

  return groups;
}

function priceLabel(product) {
  return `${product.description} — ${Math.round(product.price / 100)} €`;
}

// Шаг 1: формат. Пакетов полтора десятка, в одну клавиатуру они не лезут,
// поэтому сначала формат, потом пакет внутри него.
async function handleMgrPayLink(chatId, bookingId, callbackQueryId) {
  const booking = await getBooking(bookingId);

  if (!booking) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  if (!booking.chatId) {
    await answerCallback(callbackQueryId, 'У ученика нет чата с ботом');
    return;
  }

  if (booking.status === 'cancelled') {
    await answerCallback(callbackQueryId, 'Запись отменена');
    return;
  }

  let groups;

  try {
    groups = await loadPriceGroups();
  } catch (e) {
    console.error('Price list error:', e);
    await answerCallback(callbackQueryId, 'Прайс недоступен, попробуйте ещё раз');
    return;
  }

  const intro = await introMenu(booking);

  await answerCallback(callbackQueryId);
  await sendMessage(
    chatId,
    `💳 <b>Что оплачивает ученик</b>\n${booking.name || 'Ученик'}, код <code>${booking.id}</code>${intro.note}\n\nВыберите формат:`,
    {
      inline_keyboard: intro.rows.concat(groups.map(group => [{
        text: group.name,
        callback_data: `mgr_payg:${bookingId}:${group.id}`
      }]))
    }
  );
}

// Шаг 2: пакет внутри формата.
async function handleMgrPayGroup(chatId, bookingId, groupId, callbackQueryId) {
  let groups;

  try {
    groups = await loadPriceGroups();
  } catch (e) {
    console.error('Price list error:', e);
    await answerCallback(callbackQueryId, 'Прайс недоступен, попробуйте ещё раз');
    return;
  }

  const group = groups.find(item => item.id === groupId);

  if (!group) {
    await answerCallback(callbackQueryId, 'Формат не найден');
    return;
  }

  await answerCallback(callbackQueryId);
  await sendMessage(
    chatId,
    `💳 <b>${group.name}</b>\n\nВыберите пакет:`,
    {
      inline_keyboard: group.items
        .map(product => [{
          text: priceLabel(product),
          callback_data: `mgr_payp:${bookingId}:${product.external_id}`
        }])
        .concat([[{ text: '‹ Назад к форматам', callback_data: `mgr_pay:${bookingId}` }]])
    }
  );
}

// Шаг 3: ссылка ученику. В ней и код записи, и выбранный пакет:
// клиенту остаётся ввести почту и заплатить.
async function handleMgrPaySend(chatId, bookingId, packId, callbackQueryId) {
  const booking = await getBooking(bookingId);

  if (!booking || !booking.chatId) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  if (booking.status === 'cancelled') {
    await answerCallback(callbackQueryId, 'Запись отменена');
    return;
  }

  let product = null;

  try {
    const groups = await loadPriceGroups();

    for (const group of groups) {
      const found = group.items.find(item => item.external_id === packId);
      if (found) product = found;
    }
  } catch (e) {
    console.error('Price list error:', e);
  }

  if (!product) {
    await answerCallback(callbackQueryId, 'Пакет не найден');
    return;
  }

  const link = `https://www.sayyestoenglish.com/?b=${encodeURIComponent(booking.id)}&p=${encodeURIComponent(product.external_id)}`;
  const price = `${Math.round(product.price / 100)} €`;

  await answerCallback(callbackQueryId);
  await sendMessage(
    booking.chatId,
    '💳 <b>Оплата обучения</b>\n\n' +
    `${product.name} · ${product.description}\nСтоимость: <b>${price}</b>\n\n` +
    `<a href="${link}">Перейти к оплате</a>\n\n` +
    'Пакет уже выбран — на странице нужно только указать почту и оплатить. После оплаты менеджер подберёт группу или преподавателя.'
  );

  await sendMessage(chatId, `Ссылка отправлена: ${booking.name || 'ученик'} — ${product.name} · ${product.description}, ${price}.`);
}

// Дедлайн для менеджера: базовый пояс расписания, тот же, в котором работает /today.
function introDeadlineText(value) {
  return new Date(value).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow'
  });
}

// Спецпредложение показываем только после отметки «Пришёл»: это оффер
// за состоявшийся урок, а не за запись.
async function introMenu(booking) {
  if (!booking.attended) return { rows: [], note: '' };

  let items = [];

  try {
    items = await getIntroProducts();
  } catch (e) {
    console.error('Intro products error:', e);
    return { rows: [], note: '' };
  }

  if (!items.length) return { rows: [], note: '' };

  const rows = items.map(item => [{
    text: `🎁 ${item.name} — ${Math.round(item.price / 100)} €`,
    callback_data: `mgr_payi:${booking.id}:${item.external_id}`
  }]);

  const expiry = introExpiry(booking);
  const note = introActive(booking)
    ? `\n\n🎁 Спецпредложение действует до ${introDeadlineText(expiry)}.`
    : '\n\n🎁 Спецпредложение истекло. Отправите снова — отсчёт трёх суток пойдёт заново.';

  return { rows, note };
}

// Интро-оффер: цена и срок. Отправка запускает отсчёт заново, поэтому этой же
// кнопкой менеджер продлевает предложение, если человек не успел.
async function handleMgrPayIntro(chatId, bookingId, packId, callbackQueryId) {
  const booking = await getBooking(bookingId);

  if (!booking || !booking.chatId) {
    await answerCallback(callbackQueryId, 'Запись не найдена');
    return;
  }

  // Кнопка живёт в переписке вечно: старое сообщение можно нажать через неделю.
  if (booking.status === 'cancelled') {
    await answerCallback(callbackQueryId, 'Запись отменена');
    return;
  }

  if (!booking.attended) {
    await answerCallback(callbackQueryId, 'Сначала отметьте «Пришёл»');
    return;
  }

  if (booking.introPaid) {
    await answerCallback(callbackQueryId, 'Спецпредложение уже оплачено');
    return;
  }

  const product = await getIntroProduct(packId);

  if (!product) {
    await answerCallback(callbackQueryId, 'Спецпредложение недоступно');
    return;
  }

  const expiresAt = introActive(booking)
    ? introExpiry(booking).toISOString()
    : nextIntroExpiry();

  await updateBooking(bookingId, {
    introExpiresAt: expiresAt,
    introPack: product.external_id,
    introSentAt: new Date().toISOString()
  });

  const link = `https://www.sayyestoenglish.com/?b=${encodeURIComponent(booking.id)}&p=${encodeURIComponent(product.external_id)}`;
  const price = `${Math.round(product.price / 100)} €`;

  await answerCallback(callbackQueryId);
  await sendMessage(
    booking.chatId,
    '🎁 <b>Специальное предложение после пробного урока</b>\n\n' +
    `${product.name}\n${product.description}\nЦена: <b>${price}</b>\n\n` +
    `<a href="${link}">Перейти к оплате</a>\n\n` +
    'Предложение действует трое суток. Заполнять ничего не нужно — чек придёт на почту, которую вы указали при записи.'
  );

  await sendMessage(
    chatId,
    `🎁 Спецпредложение отправлено: ${booking.name || 'ученик'} — ${product.name}, ${price}.\nДействует до ${introDeadlineText(expiresAt)}.`
  );
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
        case 'mgr_pay':
          await handleMgrPayLink(chatId, bookingId, callbackId);
          break;
        case 'mgr_payg':
          await handleMgrPayGroup(chatId, bookingId, params[1], callbackId);
          break;
        case 'mgr_payp':
          await handleMgrPaySend(chatId, bookingId, params[1], callbackId);
          break;
        case 'mgr_payi':
          await handleMgrPayIntro(chatId, bookingId, params[1], callbackId);
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
          await handleAttendance(chatId, bookingId, true, callbackId, messageId, from);
          break;
        case 'noshow':
          await handleAttendance(chatId, bookingId, false, callbackId, messageId, from);
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

        if (text === '/who') {
          await handleWhoCommand(chatId);
          return NextResponse.json({ ok: true });
        }

        if (text === '/pending') {
          await handlePendingCommand(chatId);
          return NextResponse.json({ ok: true });
        }

        if (text && text.startsWith('/stats')) {
          await handleStatsCommand(chatId, text);
          return NextResponse.json({ ok: true });
        }

        if (text && text.startsWith('/cleanup')) {
          await handleCleanupCommand(chatId, text);
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
            '/stats — сводка по заявкам за 7 дней, /stats 30 — за месяц\n' +
            '/stats_today и /stats_yesterday — за сегодня и за вчера\n' +
            '/pending — заявки без выбранного времени\n' +
            '/who — кто из менеджеров получает уведомления\n' +
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
      // Команда со слешем, до которой мы дошли сюда, — либо незнакомая, либо
      // менеджерская от обычного человека. Раньше она проваливалась дальше и
      // превращалась в чужой ответ: «/stats» отдавал карточку собственной записи.
      if (text && text.startsWith('/')) {
        const command = text.split(/\s+/)[0].toLowerCase();
        const managerCommands = ['/book', '/today', '/bookings', '/find', '/stats', '/pending', '/who', '/cleanup', '/help'];

        if (managerCommands.includes(command)) {
          await sendMessage(chatId, 'Эта команда доступна только менеджерам школы.');
        } else {
          await sendMessage(chatId,
            'Такой команды нет.\n\n' +
            '/myrecord — показать вашу запись\n' +
            'Записаться: https://www.sayyestoenglish.com/learn_easy'
          );
        }

        return NextResponse.json({ ok: true });
      }

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

      // Кто пишет, выясняем до того, как решать, чей это сценарий. Менеджер со своей
      // тестовой записью попадал в клиентскую пересылку: его «привет» уходил всем
      // менеджерам с шапкой «Сообщение от …». Режим пересылки у менеджеров гасим.
      const senderIsManager = isManager(username) || await isManagerChat(chatId);

      if (senderIsManager) {
        await kvDel(`relay:${chatId}`);
      } else {
        const relayHandled = await handleRelayFromUser(chatId, update.message);
        if (relayHandled) return NextResponse.json({ ok: true });
      }

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
