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

async function handleStart(chatId, username, args) {
  // Check if manager
  if (isManager(username)) {
    await setManagerChatId(chatId);
    await sendMessage(chatId,
      'Вы зарегистрированы как менеджер SAY YES!\n\n' +
      'Вы будете получать уведомления о новыф заявках, отменах и переносах.\n\n' +
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
      'Добро пожаловать в SAY YES! English School!\n\n' +
      'К сожалению, эта ссылка устарела. Пожалуйста, запишитесь заново на нашем сайте.\n\n' +
      'Если у вас есть активная запись, она появитсь здесь автоматически.'
    );
    return;
  }

  // Regular /start without deep link
  const existingBookingId = await getUserBooking(chatId);
  if (existingBookingId) {
    const booking = await getBooking(existingBookingId);
    if (booking && booking.status === 'confirmed') {
      await sendMessage(chatId,
        `Добро пожаловать в SAY YES! English School!\n\n` +
        `У вас есть активная запись:\n` +
        `Дата: ${booking.slotDate}\n` +
        `Время (МСК): ${booking.slotMsk}\n\n` +
        `Что хотите сделать?`,
        bookingActionsKeyboard(existingBookingId)
      );
      return;
    }
  }

  await sendMessage(chatId,
    'Добро пожаловать в SAY YES! English School!\n\n' +
    'Чтобы записатьсь на бесплатную консультацию, перейдите на наш сайт:\n' +
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
    `Дата: ${booking.slotDate}\nВремя (МСК): ${booking.slotMsk}`,
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

  const bookedSlots = await getBookedSlots();
  const available = generateAvailableSlots(bookedSlots);

  if (available.length === 0) {
    await answerCallback(callbackQueryId);
    await sendMessage(chatId,
      'К сожалению, сейчас нет доступных слотов.\n' +
      'Попробуйте позже или свяжитесь с менеджером.',
      bookingActionsKeyboard(bookingId)
    );
    return;
  }

  await answerCallback(callbackQueryId);
  await sendMessage(chatId,
    `Текущая запись: ${booking.slotDate}, ${booking.slotMsk} (МСК)\n\n` +
    `Выберите новое время:`,
    slotsKeyboard(available, bookingId)
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
    reminded24h: false,
    reminded1h: false
  });

  await answerCallback(callbackQueryId, 'Запись перенесен!');
  await editMessage(chatId, messageId,
    `Ђапись перенесенв!\n\n` +
    `Новая дата: ${newSlotDate}\n` +
    `Время (МСК): ${time}\n` +
    `Х �рмат: @онсультация · 30 мин · Zoom`,
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
    'Напишите ваше сообщение, и мы передадим его менеджеру.\n\n' +
    'Менеджер ответит вам здесь, в этом чате.\n\n' +
    '<i>Чтобы выйти из режима связи, отправьтесь /cancel</i>'
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

// --- Relay messages ---

async function handleRelayFromUser(chatId, message) {
  const relayBookingId = await kvGet(`relay:${chatId}`);
  if (!relayBookingId) return false;

  const booking = await getBooking(relayBookingId);
  const managerChatId = await getManagerChatId();

  if (!managerChatId) {
    await sendMessage(chatId, 'К сожалению, менеджер сейчас недоступен. Попробуйте позже.');
    return true;
  }

  // Forward message to manager with context
  const header = `Сообщение от ${booking?.name || 'ученика'} (${booking?.telegram || ''}):\n` +
    `Запись: ${booking?.slotDate || '—'}, ${booking?.slotMsk || '—'} МСК\n` +
    `‐‐‐‐‐‐‐‐‐‐‐‐‐‐‗b�`;

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
    '<i>Птобы выйти /done чтобы закончить диалог</i>'
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

      // Save username→chatId mapping for daily summaries
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
            'У вас есть активная запись. Что хотите сделать?',
            bookingActionsKeyboard(bookingId)
          );
          return NextResponse.json({ ok: true });
        }
      }

      await sendMessage(chatId,
        'Чтобы записаться на бесплатную консультацию:\n' +
        'https://www.sayyestoenglish.com/learn_easy\n\n' +
        'Командч:\n/myrecord — показать вашу запись'
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
