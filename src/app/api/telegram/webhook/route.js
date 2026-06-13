import { NextResponse } from 'next/server';
import {
  getBooking, updateBooking, getBookedSlots, removeBookedSlot, addBookedSlot,
  setUserBooking, getUserBooking, clearUserBooking,
  getPendingBooking, clearPendingBooking,
  setManagerChatId, getManagerChatId,
  getAllActiveBookings, kvSet, kvGet, kvDel
} from '@/lib/redis';
import {
  sendMessage, editMessage, answerCallback, forwardMessage,
  bookingActionsKeyboard, confirmCancelKeyboard, slotsKeyboard,
  formatBookingConfirmation, formatBookingForManager, formatReminder,
  isManager
} from '@/lib/telegram';

// Verify webhook secret (optional extra security)
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// --- Available slots generation ---
function generateAvailableSlots(bookedSlots) {
  const slots = [];
  const now = new Date();
  const mskOffset = 3 * 60; // UTC+3

  // Generate slots for next 7 days
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
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
      const dayNames = ['ÐÑ', 'ÐÐ½', 'ÐÑ', 'Ð¡Ñ', 'Ð§Ñ', 'ÐÑ', 'Ð¡Ð±'];
      const monthNames = ['ÑÐ½Ð²', 'ÑÐµÐ²', 'Ð¼Ð°Ñ', 'Ð°Ð¿Ñ', 'Ð¼Ð°Ð¹', 'Ð¸ÑÐ½', 'Ð¸ÑÐ»', 'Ð°Ð²Ð³', 'ÑÐµÐ½', 'Ð¾ÐºÑ', 'Ð½Ð¾Ñ', 'Ð´ÐµÐº'];
      const dayName = dayNames[date.getDay()];
      const monthName = monthNames[date.getMonth()];
      const label = `${dayName}, ${date.getDate()} ${monthName} ${time}`;

      slots.push({ key: slotKey, label });
    }
  }
  return slots.slice(0, 20); // Max 20 slots to show
}

// --- Command handlers ---

async function handleStart(chatId, username, args) {
  // Check if manager
  if (isManager(username)) {
    await setManagerChatId(chatId);
    await sendMessage(chatId,
      'ÐÑ Ð·Ð°ÑÐµÐ³Ð¸ÑÑÑÐ¸ÑÐ¾Ð²Ð°Ð½Ñ ÐºÐ°Ðº Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑ SAY YES!\n\n' +
      'ÐÑ Ð±ÑÐ´ÐµÑÐµ Ð¿Ð¾Ð»ÑÑÐ°ÑÑ ÑÐ²ÐµÐ´Ð¾Ð¼Ð»ÐµÐ½Ð¸Ñ Ð¾ Ð½Ð¾Ð²ÑÑ Ð·Ð°ÑÐ²ÐºÐ°Ñ, Ð¾ÑÐ¼ÐµÐ½Ð°Ñ Ð¸ Ð¿ÐµÑÐµÐ½Ð¾ÑÐ°Ñ.\n\n' +
      'ÐÐ¾Ð³Ð´Ð° ÑÑÐµÐ½Ð¸Ðº Ð½Ð°Ð¿Ð¸ÑÐµÑ ÑÐµÑÐµÐ· Ð±Ð¾ÑÐ°, ÐµÐ³Ð¾ ÑÐ¾Ð¾Ð±ÑÐµÐ½Ð¸Ñ Ð±ÑÐ´ÑÑ Ð¿ÐµÑÐµÑÑÐ»Ð°ÑÑÑÑ Ð²Ð°Ð¼ ÑÑÐ´Ð°. ' +
      'ÐÑÐ²ÐµÑÑÑÐµ Ð½Ð° Ð¿ÐµÑÐµÑÐ»Ð°Ð½Ð½Ð¾Ðµ ÑÐ¾Ð¾Ð±ÑÐµÐ½Ð¸Ðµ, Ð¸ Ð²Ð°Ñ Ð¾ÑÐ²ÐµÑ Ð±ÑÐ´ÐµÑ Ð¾ÑÐ¿ÑÐ°Ð²Ð»ÐµÐ½ ÑÑÐµÐ½Ð¸ÐºÑ.'
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

      // Send confirmation to user
      await sendMessage(chatId,
        formatBookingConfirmation(booking),
        bookingActionsKeyboard(bookingId)
      );

      // Notify manager
      const managerChatId = await getManagerChatId();
      if (managerChatId) {
        await sendMessage(managerChatId, formatBookingForManager(booking, 'new'));
      }
      return;
    }

    // Booking not found - maybe expired
    await sendMessage(chatId,
      'ÐÐ¾Ð±ÑÐ¾ Ð¿Ð¾Ð¶Ð°Ð»Ð¾Ð²Ð°ÑÑ Ð² SAY YES! English School!\n\n' +
      'Ð ÑÐ¾Ð¶Ð°Ð»ÐµÐ½Ð¸Ñ, ÑÑÐ° ÑÑÑÐ»ÐºÐ° ÑÑÑÐ°ÑÐµÐ»Ð°. ÐÐ¾Ð¶Ð°Ð»ÑÐ¹ÑÑÐ°, Ð·Ð°Ð¿Ð¸ÑÐ¸ÑÐµÑÑ Ð·Ð°Ð½Ð¾Ð²Ð¾ Ð½Ð° Ð½Ð°ÑÐµÐ¼ ÑÐ°Ð¹ÑÐµ.\n\n' +
      'ÐÑÐ»Ð¸ Ñ Ð²Ð°Ñ ÐµÑÑÑ Ð°ÐºÑÐ¸Ð²Ð½Ð°Ñ Ð·Ð°Ð¿Ð¸ÑÑ, Ð¾Ð½Ð° Ð¿Ð¾ÑÐ²Ð¸ÑÑÑ Ð·Ð´ÐµÑÑ Ð°Ð²ÑÐ¾Ð¼Ð°ÑÐ¸ÑÐµÑÐºÐ¸.'
    );
    return;
  }

  // Regular /start without deep link
  const existingBookingId = await getUserBooking(chatId);
  if (existingBookingId) {
    const booking = await getBooking(existingBookingId);
    if (booking && booking.status === 'confirmed') {
      await sendMessage(chatId,
        `ÐÐ¾Ð±ÑÐ¾ Ð¿Ð¾Ð¶Ð°Ð»Ð¾Ð²Ð°ÑÑ Ð² SAY YES! English School!\n\n` +
        `Ð£ Ð²Ð°Ñ ÐµÑÑÑ Ð°ÐºÑÐ¸Ð²Ð½Ð°Ñ Ð·Ð°Ð¿Ð¸ÑÑ:\n` +
        `ÐÐ°ÑÐ°: ${booking.slotDate}\n` +
        `ÐÑÐµÐ¼Ñ (ÐÐ¡Ð): ${booking.slotMsk}\n\n` +
        `Ð§ÑÐ¾ ÑÐ¾ÑÐ¸ÑÐµ ÑÐ´ÐµÐ»Ð°ÑÑ?`,
        bookingActionsKeyboard(existingBookingId)
      );
      return;
    }
  }

  await sendMessage(chatId,
    'ÐÐ¾Ð±ÑÐ¾ Ð¿Ð¾Ð¶Ð°Ð»Ð¾Ð²Ð°ÑÑ Ð² SAY YES! English School!\n\n' +
    'Ð§ÑÐ¾Ð±Ñ Ð·Ð°Ð¿Ð¸ÑÐ°ÑÑÑÑ Ð½Ð° Ð±ÐµÑÐ¿Ð»Ð°ÑÐ½ÑÑ ÐºÐ¾Ð½ÑÑÐ»ÑÑÐ°ÑÐ¸Ñ, Ð¿ÐµÑÐµÐ¹Ð´Ð¸ÑÐµ Ð½Ð° Ð½Ð°Ñ ÑÐ°Ð¹Ñ:\n' +
    'https://www.sayyestoenglish.com/learn_easy\n\n' +
    'ÐÐ¾ÑÐ»Ðµ Ð·Ð°Ð¿Ð¸ÑÐ¸ Ð²Ñ Ð¿Ð¾Ð»ÑÑÐ¸ÑÐµ Ð¿Ð¾Ð´ÑÐ²ÐµÑÐ¶Ð´ÐµÐ½Ð¸Ðµ Ð·Ð´ÐµÑÑ.'
  );
}

async function handleCancel(chatId, bookingId, callbackQueryId) {
  const booking = await getBooking(bookingId);
  if (!booking || booking.status !== 'confirmed') {
    await answerCallback(callbackQueryId, 'ÐÐ°Ð¿Ð¸ÑÑ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°');
    return;
  }

  await answerCallback(callbackQueryId);
  await sendMessage(chatId,
    `ÐÑ ÑÐ²ÐµÑÐµÐ½Ñ, ÑÑÐ¾ ÑÐ¾ÑÐ¸ÑÐµ Ð¾ÑÐ¼ÐµÐ½Ð¸ÑÑ Ð·Ð°Ð¿Ð¸ÑÑ?\n\n` +
    `ÐÐ°ÑÐ°: ${booking.slotDate}\nÐÑÐµÐ¼Ñ (ÐÐ¡Ð): ${booking.slotMsk}`,
    confirmCancelKeyboard(bookingId)
  );
}

async function handleConfirmCancel(chatId, bookingId, callbackQueryId, messageId) {
  const booking = await getBooking(bookingId);
  if (!booking) {
    await answerCallback(callbackQueryId, 'ÐÐ°Ð¿Ð¸ÑÑ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°');
    return;
  }

  // Free the slot
  if (booking.slot && booking.slot !== 'no_time') {
    await removeBookedSlot(booking.slot);
  }

  // Update booking status
  await updateBooking(bookingId, { status: 'cancelled' });
  await clearUserBooking(chatId);

  await answerCallback(callbackQueryId, 'ÐÐ°Ð¿Ð¸ÑÑ Ð¾ÑÐ¼ÐµÐ½ÐµÐ½Ð°');
  await editMessage(chatId, messageId,
    'ÐÐ°ÑÐ° Ð·Ð°Ð¿Ð¸ÑÑ Ð¾ÑÐ¼ÐµÐ½ÐµÐ½Ð°.\n\n' +
    'ÐÑÐ»Ð¸ Ð·Ð°ÑÐ¾ÑÐ¸ÑÐµ Ð·Ð°Ð¿Ð¸ÑÐ°ÑÑÑÑ ÑÐ½Ð¾Ð²Ð°:\nhttps://www.sayyestoenglish.com/learn_easy'
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
    await answerCallback(callbackQueryId, 'ÐÐ°Ð¿Ð¸ÑÑ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°');
    return;
  }

  const bookedSlots = await getBookedSlots();
  const available = generateAvailableSlots(bookedSlots);

  if (available.length === 0) {
    await answerCallback(callbackQueryId);
    await sendMessage(chatId,
      'Ð ÑÐ¾Ð¶Ð°Ð»ÐµÐ½Ð¸Ñ, ÑÐµÐ¹ÑÐ°Ñ Ð½ÐµÑ Ð´Ð¾ÑÑÑÐ¿Ð½ÑÑ ÑÐ»Ð¾ÑÐ¾Ð².\n' +
      'ÐÐ¾Ð¿ÑÐ¾Ð±ÑÐ¹ÑÐµ Ð¿Ð¾Ð·Ð¶Ðµ Ð¸Ð»Ð¸ ÑÐ²ÑÐ¶Ð¸ÑÐµÑÑ Ñ Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑÐ¾Ð¼.',
      bookingActionsKeyboard(bookingId)
    );
    return;
  }

  await answerCallback(callbackQueryId);
  await sendMessage(chatId,
    `Ð¢ÐµÐºÑÑÐ°Ñ Ð·Ð°Ð¿Ð¸ÑÑ: ${booking.slotDate}, ${booking.slotMsk} (ÐÐ¡Ð)\n\n` +
    `ÐÑÐ±ÐµÑÐ¸ÑÐµ Ð½Ð¾Ð²Ð¾Ðµ Ð²ÑÐµÐ¼Ñ:`,
    slotsKeyboard(available, bookingId)
  );
}

async function handleNewSlot(chatId, bookingId, newSlotKey, callbackQueryId, messageId) {
  const booking = await getBooking(bookingId);
  if (!booking) {
    await answerCallback(callbackQueryId, 'ÐÐ°Ð¿Ð¸ÑÑ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°');
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
  const dayNames = ['ÐÑ', 'ÐÐ½', 'ÐÑ', 'Ð¡Ñ', 'Ð§Ñ', 'ÐÑ', 'Ð¡Ð±'];
  const monthNames = ['ÑÐ½Ð²', 'ÑÐµÐ²', 'Ð¼Ð°Ñ', 'Ð°Ð¿Ñ', 'Ð¼Ð°Ð¹', 'Ð¸ÑÐ½', 'Ð¸ÑÐ»', 'Ð°Ð²Ð³', 'ÑÐµÐ½', 'Ð¾ÐºÑ', 'Ð½Ð¾Ñ', 'Ð´ÐµÐº'];
  const newSlotDate = `${dayNames[slotDateObj.getDay()]}, ${slotDateObj.getDate()} ${monthNames[slotDateObj.getMonth()]}`;

  // Update booking
  const updated = await updateBooking(bookingId, {
    slot: newSlotKey,
    slotMsk: time,
    slotDate: newSlotDate,
    reminded24h: false,
    reminded1h: false
  });

  await answerCallback(callbackQueryId, 'ÐÐ°Ð¿Ð¸ÑÑ Ð¿ÐµÑÐµÐ½ÐµÑÐµÐ½Ð°!');
  await editMessage(chatId, messageId,
    `ÐÐ°Ð¿Ð¸ÑÑ Ð¿ÐµÑÐµÐ½ÐµÑÐµÐ½Ð°!\n\n` +
    `ÐÐ¾Ð²Ð°Ñ Ð´Ð°ÑÐ°: ${newSlotDate}\n` +
    `ÐÑÐµÐ¼Ñ (ÐÐ¡Ð): ${time}\n` +
    `Ð¤Ð¾ÑÐ¼Ð°Ñ: ÐÐ¾Ð½ÑÑÐ»ÑÑÐ°ÑÐ¸Ñ Â· 30 Ð¼Ð¸Ð½ Â· Zoom`,
    bookingActionsKeyboard(bookingId)
  );

  // Notify manager
  const managerChatId = await getManagerChatId();
  if (managerChatId && updated) {
    await sendMessage(managerChatId, formatBookingForManager(updated, 'reschedule'));
  }
}

async function handleContact(chatId, bookingId, callbackQueryId) {
  await answerCallback(callbackQueryId);

  // Store relay mode
  await kvSet(`relay:${chatId}`, bookingId);

  await sendMessage(chatId,
    'ÐÐ°Ð¿Ð¸ÑÐ¸ÑÐµ Ð²Ð°ÑÐµ ÑÐ¾Ð¾Ð±ÑÐµÐ½Ð¸Ðµ, Ð¸ Ð¼Ñ Ð¿ÐµÑÐµÐ´Ð°Ð´Ð¸Ð¼ ÐµÐ³Ð¾ Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑÑ.\n\n' +
    'ÐÐµÐ½ÐµÐ´Ð¶ÐµÑ Ð¾ÑÐ²ÐµÑÐ¸Ñ Ð²Ð°Ð¼ Ð·Ð´ÐµÑÑ, Ð² ÑÑÐ¾Ð¼ ÑÐ°ÑÐµ.\n\n' +
    '<i>Ð§ÑÐ¾Ð±Ñ Ð²ÑÐ¹ÑÐ¸ Ð¸Ð· ÑÐµÐ¶Ð¸Ð¼Ð° ÑÐ²ÑÐ·Ð¸, Ð¾ÑÐ¿ÑÐ°Ð²ÑÑÐµ /cancel</i>'
  );
}

async function handleKeep(chatId, bookingId, callbackQueryId, messageId) {
  const booking = await getBooking(bookingId);
  await answerCallback(callbackQueryId, 'Ð¥Ð¾ÑÐ¾ÑÐ¾, Ð·Ð°Ð¿Ð¸ÑÑ ÑÐ¾ÑÑÐ°Ð½ÐµÐ½Ð°');

  if (booking) {
    await editMessage(chatId, messageId,
      formatBookingConfirmation(booking),
      bookingActionsKeyboard(bookingId)
    );
  }
}

// --- Relay messages ---

async function handleRelayFromUser(chatId, message) {
  const relayBookingId = await kvGet(`relay:${chatId}`);
  if (!relayBookingId) return false;

  const booking = await getBooking(relayBookingId);
  const managerChatId = await getManagerChatId();

  if (!managerChatId) {
    await sendMessage(chatId, 'Ð ÑÐ¾Ð¶Ð°Ð»ÐµÐ½Ð¸Ñ, Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑ ÑÐµÐ¹ÑÐ°Ñ Ð½ÐµÐ´Ð¾ÑÑÑÐ¿ÐµÐ½. ÐÐ¾Ð¿ÑÐ¾Ð±ÑÐ¹ÑÐµ Ð¿Ð¾Ð·Ð¶Ðµ.');
    return true;
  }

  // Forward message to manager with context
  const header = `Ð¡Ð¾Ð¾Ð±ÑÐµÐ½Ð¸Ðµ Ð¾Ñ ${booking?.name || 'ÑÑÐµÐ½Ð¸ÐºÐ°'} (${booking?.telegram || ''}):\n` +
    `ÐÐ°Ð¿Ð¸ÑÑ: ${booking?.slotDate || 'â'}, ${booking?.slotMsk || 'â'} ÐÐ¡Ð\n` +
    `ââââââââââââââââ`;

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
    'Ð¡Ð¾Ð¾Ð±ÑÐµÐ½Ð¸Ðµ Ð¾ÑÐ¿ÑÐ°Ð²Ð»ÐµÐ½Ð¾ Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑÑ. ÐÐ¶Ð¸Ð´Ð°Ð¹ÑÐµ Ð¾ÑÐ²ÐµÑÐ°.\n\n' +
    '<i>ÐÑÐ¿ÑÐ°Ð²ÑÑÐµ /done ÑÑÐ¾Ð±Ñ Ð·Ð°ÐºÐ¾Ð½ÑÐ¸ÑÑ Ð´Ð¸Ð°Ð»Ð¾Ð³</i>'
  );
  return true;
}

async function handleRelayFromManager(managerChatId, message) {
  // Check if manager is replying to a user
  const targetChatId = await kvGet(`mgr_reply:${managerChatId}`);
  if (!targetChatId) return false;

  if (message.text) {
    await sendMessage(targetChatId, `ÐÑÐ²ÐµÑ Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑÐ°:\n\n${message.text}`);
  } else {
    await forwardMessage(targetChatId, managerChatId, message.message_id);
  }

  await sendMessage(managerChatId, 'ÐÑÐ²ÐµÑ Ð¾ÑÐ¿ÑÐ°Ð²Ð»ÐµÐ½ ÑÑÐµÐ½Ð¸ÐºÑ.');
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
        case 'contact':
          await handleContact(chatId, bookingId, callbackId);
          break;
        case 'keep':
          await handleKeep(chatId, bookingId, callbackId, messageId);
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

      // Save usernameâchatId mapping for daily summaries
      if (username) {
        await kvSet(`user_chat:${username.toLowerCase()}`, String(chatId));
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
                'ÐÐ¸Ð°Ð»Ð¾Ð³ Ñ Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑÐ¾Ð¼ Ð·Ð°Ð²ÐµÑÑÑÐ½.\n\nÐÐ°ÑÐ° Ð·Ð°Ð¿Ð¸ÑÑ:',
              );
              await sendMessage(chatId,
                formatBookingConfirmation(booking),
                bookingActionsKeyboard(bookingId)
              );
              return NextResponse.json({ ok: true });
            }
          }
          await sendMessage(chatId, 'ÐÐ¸Ð°Ð»Ð¾Ð³ Ñ Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑÐ¾Ð¼ Ð·Ð°Ð²ÐµÑÑÑÐ½.');
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
          'Ð£ Ð²Ð°Ñ Ð½ÐµÑ Ð°ÐºÑÐ¸Ð²Ð½ÑÑ Ð·Ð°Ð¿Ð¸ÑÐµÐ¹.\n\n' +
          'ÐÐ°Ð¿Ð¸ÑÐ°ÑÑÑÑ: https://www.sayyestoenglish.com/learn_easy'
        );
        return NextResponse.json({ ok: true });
      }

      // Check if this is a relay message from user
      const relayHandled = await handleRelayFromUser(chatId, update.message);
      if (relayHandled) return NextResponse.json({ ok: true });

      // Check if manager is replying
      const managerChatIdStored = await getManagerChatId();
      if (String(chatId) === String(managerChatIdStored)) {
        const relayFromMgr = await handleRelayFromManager(chatId, update.message);
        if (relayFromMgr) return NextResponse.json({ ok: true });
      }

      // Default response for unknown messages
      const bookingId = await getUserBooking(chatId);
      if (bookingId) {
        const booking = await getBooking(bookingId);
        if (booking && booking.status === 'confirmed') {
          await sendMessage(chatId,
            'Ð£ Ð²Ð°Ñ ÐµÑÑÑ Ð°ÐºÑÐ¸Ð²Ð½Ð°Ñ Ð·Ð°Ð¿Ð¸ÑÑ. Ð§ÑÐ¾ ÑÐ¾ÑÐ¸ÑÐµ ÑÐ´ÐµÐ»Ð°ÑÑ?',
            bookingActionsKeyboard(bookingId)
          );
          return NextResponse.json({ ok: true });
        }
      }

      await sendMessage(chatId,
        'Ð§ÑÐ¾Ð±Ñ Ð·Ð°Ð¿Ð¸ÑÐ°ÑÑÑÑ Ð½Ð° Ð±ÐµÑÐ¿Ð»Ð°ÑÐ½ÑÑ ÐºÐ¾Ð½ÑÑÐ»ÑÑÐ°ÑÐ¸Ñ:\n' +
        'https://www.sayyestoenglish.com/learn_easy\n\n' +
        'ÐÐ¾Ð¼Ð°Ð½Ð´Ñ:\n/myrecord â Ð¿Ð¾ÐºÐ°Ð·Ð°ÑÑ Ð²Ð°ÑÑ Ð·Ð°Ð¿Ð¸ÑÑ'
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
