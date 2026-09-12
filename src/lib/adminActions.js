import { getBooking, updateBooking, addBookedSlot, removeBookedSlot, getBookedSlots, kvSet, kvGet, kvKeys } from '@/lib/redis';
import { sendMessage, formatManagerCard } from '@/lib/telegram';
import { notifyManagers } from '@/lib/managers';
import { sendTrialAttended, sendPurchase } from '@/lib/meta';
import { getIntroProduct, getIntroProducts, introActive, nextIntroExpiry } from '@/services/intro';
import { getProducts } from '@/services/stripe';
import { sendIntroOfferEmail, sendBookingConfirmation } from '@/lib/email';
import { addMessage } from '@/lib/thread';

// Действия менеджера из веба. Делают ровно то же, что кнопки бота, и теми же
// полями заявки: иначе две половины системы начнут расходиться в цифрах.
// Каждое действие уведомляет менеджеров в Telegram — бот остаётся общим чатом,
// даже если работа идёт в браузере.

const SITE = () => process.env.PUBLIC_BASE_URL || 'https://www.sayyestoenglish.com';

export function payLink(bookingId, externalId) {
  return SITE() + '/?b=' + encodeURIComponent(bookingId) + '&p=' + encodeURIComponent(externalId);
}

function slotStartMs(booking) {
  if (!booking || !booking.slot || booking.slot === 'no_time') return null;

  const [date, time] = String(booking.slot).split('_');
  const [h, m] = String(time || '').split(':').map(Number);
  const base = new Date(date + 'T00:00:00Z').getTime();

  if (!base || Number.isNaN(base) || Number.isNaN(h) || Number.isNaN(m)) return null;

  return base + ((h - 3) * 60 + m) * 60 * 1000;
}

// --- Отметка о приходе ---
// Повтор той же отметки снимает её, отметить будущий урок нельзя — как в боте.
export async function markAttendance(bookingId, attended, by) {
  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена' };

  if (booking.attended === attended) {
    await updateBooking(bookingId, {
      attended: null,
      attendedBy: null,
      attendanceMarkedAt: null,
      introExpiresAt: null,
      attendedSent: false
    });

    return { ok: true, message: 'Отметка снята' };
  }

  const start = slotStartMs(booking);

  if (attended && start && Date.now() < start) {
    return { ok: false, error: 'Урок ещё не начался — отметить можно после начала' };
  }

  const introPatch = attended
    ? (booking.introExpiresAt ? {} : { introExpiresAt: nextIntroExpiry() })
    : { introExpiresAt: null };

  await updateBooking(bookingId, {
    attended,
    attendanceMarkedAt: new Date().toISOString(),
    attendedBy: by ? '@' + by : null,
    ...introPatch
  });

  if (attended && !booking.attendedSent && booking.status !== 'cancelled') {
    try {
      const res = await sendTrialAttended({ ...booking, attended: true });

      if (res && res.ok) await updateBooking(bookingId, { attendedSent: true });
    } catch (e) {
      console.error('CAPI attended error:', e);
    }
  }

  await notifyManagers(
    (attended ? '✅ Отмечен приход' : '🚫 Отмечен неприход') + ' · из админки, @' + by + '\n\n'
    + formatManagerCard({ ...booking, attended, attendedBy: '@' + by })
  );

  return { ok: true, message: attended ? 'Урок отмечен состоявшимся' : 'Отмечено: не пришёл' };
}

// --- Отмена ---
export async function cancelBooking(bookingId, by) {
  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена' };
  if (booking.status === 'cancelled') return { ok: false, error: 'Запись уже отменена' };

  await updateBooking(bookingId, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    cancelledBy: '@' + by
  });

  if (booking.slot && booking.slot !== 'no_time') await removeBookedSlot(booking.slot);

  if (booking.chatId) {
    await sendMessage(booking.chatId,
      'Ваша запись на пробный урок отменена. Если это ошибка или хотите выбрать другое время — напишите нам, вернём.');
  }

  await notifyManagers('❌ Запись отменена из админки, @' + by + '\n\n' + formatManagerCard(booking));

  return { ok: true, message: 'Запись отменена, слот свободен' };
}

// --- Перенос ---
// Слот в базовом поясе расписания: 2026-09-15_17:00.
export async function rescheduleBooking(bookingId, slotKey, by) {
  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена' };
  if (!/^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/.test(String(slotKey || ''))) {
    return { ok: false, error: 'Время указано неверно. Формат: 2026-09-15_17:00' };
  }

  const taken = await getBookedSlots();

  if (taken.includes(slotKey) && slotKey !== booking.slot) {
    return { ok: false, error: 'Это время уже занято' };
  }

  const [date, time] = slotKey.split('_');

  if (booking.slot && booking.slot !== 'no_time') await removeBookedSlot(booking.slot);
  await addBookedSlot(slotKey);

  const updated = await updateBooking(bookingId, {
    slot: slotKey,
    slotDate: date,
    slotMsk: time,
    status: 'confirmed',
    rescheduledAt: new Date().toISOString(),
    rescheduledBy: '@' + by,
    // Новое время — новая цепочка касаний: старые флаги напоминаний сбрасываем.
    reminded24h: false,
    reminded1h: false,
    mailed24h: false,
    mailed1h: false,
    hostBriefed: false,
    attendanceAskedStage: 0,
    // Перенос — это новый урок: старые отметки снимаем, иначе человек
    // остаётся «не пришедшим» по уроку, которого больше нет.
    attended: null,
    attendedBy: null,
    attendanceMarkedAt: null,
    attendedSent: false,
    introExpiresAt: null,
    confirmed: false,
    confirmedAt: null,
    confirmedVia: null,
    reviveStopped: true,
    reviveStopReason: 'rebooked'
  });

  if (booking.chatId) {
    await sendMessage(booking.chatId,
      'Мы перенесли ваш пробный урок.\n\nНовое время: ' + date + ', ' + time + ' (МСК)\n\n'
      + 'Если время не подходит — напишите, подберём другое.');
  }

  try {
    await sendBookingConfirmation(updated, 'reschedule');
  } catch (e) {
    console.error('Reschedule email error:', e);
  }

  await notifyManagers('🔄 Перенос из админки, @' + by + '\n\n' + formatManagerCard(updated));

  return { ok: true, message: 'Перенесено на ' + date + ' ' + time };
}

// --- Ссылка на оплату ---
// Интро-пакеты доступны только после отметки «Пришёл» и внутри окна в трое суток.
export async function listPacks(booking) {
  const packs = [];

  if (introActive(booking)) {
    const intro = await getIntroProducts();

    for (const item of intro) {
      packs.push({ id: item.external_id, name: item.name, amount: item.amount, intro: true });
    }
  }

  try {
    const products = await getProducts();

    for (const item of products) {
      packs.push({ id: item.external_id, name: item.name, amount: item.amount, group: item.group_id });
    }
  } catch (e) {
    console.error('Products error:', e);
  }

  return packs;
}

export async function sendPayLink(bookingId, packId, by) {
  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена' };
  if (!packId) return { ok: false, error: 'Не выбран пакет' };

  const intro = await getIntroProduct(packId);

  if (intro && !introActive(booking)) {
    return { ok: false, error: 'Спецпредложение доступно только после отметки «Пришёл» и трое суток после' };
  }

  const link = payLink(bookingId, packId);
  const name = intro ? intro.name : packId;
  const text = 'Ссылка на оплату: ' + name + '\n' + link
    + (intro ? '\n\nПредложение действует трое суток после урока.' : '');

  let sent = null;

  if (booking.chatId) {
    await sendMessage(booking.chatId, text);
    sent = 'в Telegram';
  } else if (booking.email) {
    await sendIntroOfferEmail(booking, link, name, null);
    sent = 'письмом';
  }

  await updateBooking(bookingId, {
    payLinkSentAt: new Date().toISOString(),
    payLinkPack: packId,
    payLinkBy: '@' + by
  });

  if (!sent) return { ok: true, message: 'Ссылка готова, но отправить некуда: ни чата, ни почты', link };

  return { ok: true, message: 'Ссылка отправлена ' + sent, link };
}

// --- Оплата мимо кассы ---
export async function markPaid(bookingId, amountEuro, packId, by) {
  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена' };
  if (booking.paid) return { ok: false, error: 'По этой заявке оплата уже проведена' };

  const amount = Math.round(Number(amountEuro) * 100);

  if (!amount || amount < 0) return { ok: false, error: 'Сумма указана неверно' };

  const pack = packId || 'INTRO_MANUAL';
  const at = new Date().toISOString();

  await updateBooking(bookingId, {
    paid: true,
    paidAt: at,
    paidPack: pack,
    paidAmount: amount,
    paidCurrency: 'eur',
    paidVia: 'manual',
    paidBy: '@' + by
  });

  await kvSet('payment:manual_' + bookingId + '_' + Date.now(), {
    at,
    bookingId,
    email: booking.email || '',
    label: pack,
    amount,
    currency: 'eur',
    via: 'Мимо кассы'
  });

  try {
    await sendPurchase({ ...booking, paid: true, paidAmount: amount, paidPack: pack });
  } catch (e) {
    console.error('CAPI purchase error:', e);
  }

  await notifyManagers('💰 Оплата мимо кассы, провёл @' + by + '\n\n'
    + formatManagerCard({ ...booking, paid: true, paidAmount: amount, paidPack: pack }));

  return { ok: true, message: 'Оплата проведена' };
}

// --- Убрать старые хвосты ---
// Не удаление, а архив: запись пропадает из списков, сводок и аналитики,
// но остаётся в поиске и возвращается командой /cleanup undo. Ученикам и в общий
// чат ничего не уходит намеренно: это уборка, а не событие.
export async function archiveUnmarked(olderThanDays, by) {
  const days = Number(olderThanDays) || 30;
  const edge = Date.now() - days * 24 * 60 * 60 * 1000;
  const keys = await kvKeys('booking:*');
  let archived = 0;

  for (const key of keys) {
    const booking = await kvGet(key);

    if (!booking || booking.archived) continue;
    if (booking.attended === true || booking.attended === false) continue;

    const start = slotStartMs(booking);

    if (!start || start > edge) continue;

    await updateBooking(booking.id, {
      archived: true,
      archivedAt: new Date().toISOString(),
      archivedBy: '@' + by,
      archivedReason: 'старые уроки без отметки'
    });

    archived++;
  }

  return { ok: true, message: 'В архив ушло записей: ' + archived };
}

// --- Сообщение ученику ---
export async function messageStudent(bookingId, text, by) {
  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена' };
  if (!text || !text.trim()) return { ok: false, error: 'Пустое сообщение' };
  if (!booking.chatId) return { ok: false, error: 'У ученика нет чата с ботом — напишите на почту' };

  await sendMessage(booking.chatId, text.trim());

  await addMessage(bookingId, { from: 'manager', text: text.trim(), by: '@' + by });
  await updateBooking(bookingId, { lastManagerMessageAt: new Date().toISOString() });
  await notifyManagers('✍️ @' + by + ' написал(а) ученику ' + (booking.name || booking.id) + ':\n\n' + text.trim());

  return { ok: true, message: 'Сообщение отправлено' };
}
