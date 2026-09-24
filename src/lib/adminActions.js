import { getBooking, updateBooking, addBookedSlot, removeBookedSlot, getBookedSlots, kvSet, kvGet, kvKeys } from '@/lib/redis';
import { sendMessage, formatManagerCard, bookingActionsKeyboard } from '@/lib/telegram';
import { clientWhen } from '@/lib/time';
import { notifyManagers } from '@/lib/managers';
import { sendTrialAttended, sendPurchase } from '@/lib/meta';
import { getIntroProduct, getIntroProducts, introActive, nextIntroExpiry } from '@/services/intro';
import { getProducts } from '@/services/stripe';
import { sendIntroOfferEmail, sendBookingConfirmation } from '@/lib/email';
import { getAllActiveBookings } from '@/lib/redis';
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

// --- Письма, которые не ушли ---
// Когда почтовый провайдер лежит, подтверждение записи не доходит, а человек
// об этом не знает: в боте его может не быть вовсе. Результат отправки пишется
// в саму заявку (emailOk), поэтому список пострадавших у нас точный.
//
// Шлём только по будущим живым урокам: письмо «вы записаны» по уроку, который
// уже прошёл или чьё время мы освободили, хуже молчания.
export function needsMailResend(booking, now = Date.now()) {
  if (!booking || booking.emailOk !== false) return false;
  if (!booking.email) return false;
  if (booking.status === 'cancelled' || booking.releasedUnconfirmed) return false;
  if (booking.archived || booking.introTest) return false;

  const start = slotStartMs(booking);

  return Boolean(start && start > now);
}

export async function listMailResend() {
  const bookings = await getAllActiveBookings();
  const now = Date.now();

  return bookings
    .filter(booking => needsMailResend(booking, now))
    .sort((a, b) => slotStartMs(a) - slotStartMs(b));
}

export async function resendConfirmation(bookingId, by) {
  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена' };
  if (!booking.email) return { ok: false, error: 'У этой заявки нет почты' };

  const mail = await sendBookingConfirmation(booking);
  const ok = Boolean(mail && mail.ok);

  const patch = {
    emailOk: ok,
    emailNote: (mail && (mail.skipped || mail.error)) || null
  };

  // Просьбу подтвердить крон пометил отправленной, хотя она упала вместе
  // с остальными. Снимаем метки — и он дошлёт её сам в своё окно, за сутки
  // и за 12 часов до урока, когда человек ещё может среагировать.
  if (!booking.confirmed) {
    patch.mailed24h = false;
    patch.mailed12h = false;
  }

  await updateBooking(bookingId, patch);

  if (!ok) {
    return { ok: false, error: 'Письмо снова не ушло: ' + ((mail && (mail.error || mail.status)) || 'причина неизвестна') };
  }

  return { ok: true, message: 'Письмо отправлено на ' + booking.email };
}

// Пачкой, но не обязательно всем: менеджер отмечает галочками, кому слать.
// Без списка ids шлём всем подходящим. Счёт небольшой — это разовая уборка
// после аварии, а не рассылка: шлём по одному и честно считаем неудачи.
export async function resendAllConfirmations(by, ids = null) {
  const all = await listMailResend();
  const picked = Array.isArray(ids) && ids.length ? ids.map(String) : null;
  const list = picked ? all.filter(booking => picked.includes(booking.id)) : all;

  if (!all.length) return { ok: true, message: 'Некому отправлять: все письма дошли' };
  if (!list.length) return { ok: false, error: 'Никто не отмечен' };

  let sent = 0;
  const failed = [];

  for (const booking of list) {
    const result = await resendConfirmation(booking.id, by);

    if (result.ok) sent++;
    else failed.push(booking.id);
  }

  await notifyManagers('✉️ Повторная отправка писем, @' + by +
    '\nОтправлено: ' + sent + ' из ' + list.length +
    (failed.length ? '\nНе ушло: ' + failed.map(id => '<code>' + id + '</code>').join(', ') : ''));

  return {
    ok: true,
    message: 'Отправлено: ' + sent + ' из ' + list.length + (failed.length ? ', не ушло ' + failed.length : '')
  };
}

// --- Возврат одной записи ---
// Автоматика снимает неподтверждённые за 6 часов до урока, и иногда снимает зря.
// В боте есть /restore, но он возвращает ВСЕ снятые за период разом — а вернуть
// нужно обычно одного человека. Здесь возврат ровно одной записи, из её карточки.
export async function restoreBooking(bookingId, by) {
  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена' };

  const released = Boolean(booking.releasedUnconfirmed);
  const cancelled = booking.status === 'cancelled';

  if (!released && !cancelled) return { ok: false, error: 'Эта запись в силе, возвращать нечего' };

  const hasSlot = booking.slot && booking.slot !== 'no_time';

  // Слот мог уйти другому ученику, пока запись была снята. Тогда возвращать
  // некуда: две записи на одно время — худшее, что можно сделать с расписанием.
  if (hasSlot) {
    const taken = await getBookedSlots();

    if (taken.includes(booking.slot)) {
      return { ok: false, error: 'Это время уже занято другим учеником — перенесите запись на свободное' };
    }
  }

  const patch = {
    status: 'confirmed',
    releasedUnconfirmed: false,
    releasedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    // Метка защищает от повторного снятия автоматикой: без неё крон увидит
    // неподтверждённую запись за 6 часов до урока и снимет её снова.
    restoredAt: new Date().toISOString(),
    restoredBy: '@' + by
  };

  await updateBooking(bookingId, patch);

  // Карточку и кнопки строим по записи ПОСЛЕ возврата. 24.09.2026 уведомление
  // «Запись возвращена» пришло с хвостом «запись отменена»: карточка рисовалась
  // по объекту, прочитанному до обновления.
  const restored = { ...booking, ...patch };

  if (hasSlot) await addBookedSlot(booking.slot);

  // Извинение «мы освободили ваше время по ошибке» уместно, только пока урок
  // впереди. Если он уже прошёл — а так и бывает, когда автоматика сняла запись,
  // а человек всё равно пришёл, — такое письмо в спину только запутает.
  // Возвращаем тихо: статус чиним, ученика не трогаем.
  const lessonAhead = !hasSlot || slotStartMs(booking) > Date.now();
  const silent = booking.attended === true || !lessonAhead;

  if (booking.chatId && !silent) {
    await sendMessage(booking.chatId,
      'Ваше время снова за вами — мы освободили его по ошибке, извините.\n\n' + clientWhen(booking),
      bookingActionsKeyboard(booking.id, restored)
    );
  }

  await notifyManagers('↩️ Запись возвращена из админки, @' + by +
    (silent ? ' (ученику не писали: урок уже прошёл)' : '') +
    '\n\n' + formatManagerCard(restored));

  return {
    ok: true,
    message: 'Запись возвращена' + (hasSlot ? ', слот снова занят' : '') +
      (silent ? '. Ученику не писали — урок уже прошёл' : '')
  };
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
