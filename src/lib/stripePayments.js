import { stripe } from '@/services/stripe';
import { getBooking, updateBooking, kvSet, kvDel, kvKeys, kvMGet } from '@/lib/redis';
import { notifyManagers } from '@/lib/managers';
import { sendPurchase } from '@/lib/meta';

// Сверка кассы Stripe с нашей базой. Нужна потому, что оплата долетает до нас
// только вебхуком: если события не было (счёт выставили руками, вебхук не дошёл,
// человек платил не по нашей ссылке) — деньги есть, а в заявке их нет.
// Здесь мы спрашиваем Stripe напрямую и показываем всё, что он знает.

// Оплату, помеченную «не наша», больше не подбираем ни вебхуком, ни сверкой.
// Ключ нарочно не payment:*, иначе он попал бы в выручку как обычная запись.
const SKIP = 'payskip:';

export async function skippedIds() {
  const keys = await kvKeys(SKIP + '*');

  return new Set(keys.map(key => String(key).slice(SKIP.length)));
}

// Почта плательщика. По ссылке из бота она лежит в receipt_email, а при оплате
// по счёту его нет вовсе: почту знают только сам счёт и карточка клиента.
// Ровно на этом месте терялись оплаты по счетам — сверять было нечем.
export async function payerEmail(pi) {
  const direct = String(pi.receipt_email || '').trim();

  if (direct) return direct;

  if (pi.invoice) {
    try {
      const invoiceId = typeof pi.invoice === 'string' ? pi.invoice : pi.invoice.id;
      const invoice = await stripe.invoices.retrieve(invoiceId);
      const mail = String((invoice && invoice.customer_email) || '').trim();

      if (mail) return mail;
    } catch (e) {
      console.error('Invoice lookup error:', e);
    }
  }

  if (pi.customer) {
    try {
      const customerId = typeof pi.customer === 'string' ? pi.customer : pi.customer.id;
      const customer = await stripe.customers.retrieve(customerId);
      const mail = String((customer && customer.email) || '').trim();

      if (mail) return mail;
    } catch (e) {
      console.error('Customer lookup error:', e);
    }
  }

  const charge = pi.charges && pi.charges.data && pi.charges.data[0];

  return String((charge && charge.billing_details && charge.billing_details.email) || '').trim();
}

// Заявка того же человека. Берём самую свежую: у постоянного ученика заявок
// может быть несколько, и оплата относится к последней.
export function matchBooking(email, bookings) {
  const target = String(email || '').trim().toLowerCase();

  if (!target) return null;

  let best = null;

  for (const booking of bookings) {
    if (String(booking.email || '').trim().toLowerCase() !== target) continue;
    if (!best || String(booking.createdAt || '') > String(best.createdAt || '')) best = booking;
  }

  return best;
}

// Заявка по почте плательщика для оплат без кода заявки (оплата с сайта,
// по ссылке, скопированной вручную). Отменённые заявки не берём, кроме тех,
// где урок всё же состоялся: человек пришёл, а запись потом сняли.
export async function findBookingByEmail(email) {
  const target = String(email || '').trim().toLowerCase();

  if (!target) return null;

  const bookings = [];

  for (const b of await kvMGet(await kvKeys('booking:*'))) {
    if (!b || !b.id) continue;
    if (b.status === 'cancelled' && b.attended !== true) continue;
    bookings.push(b);
  }

  return matchBooking(target, bookings);
}

// Повторные оплаты по одной заявке нормальны (интро, потом пакет): в заявке
// храним последнюю оплату плюс счётчик и сумму всех. Та же логика, что в markPaid.
export function paidAccumulation(booking, amount) {
  const previousTotal = booking && booking.paid ? Number(booking.paidTotal || booking.paidAmount || 0) : 0;
  const previousCount = booking && booking.paid ? Number(booking.paymentsCount || 1) : 0;

  return { paidTotal: previousTotal + Number(amount || 0), paymentsCount: previousCount + 1 };
}

export function paymentLabel(pi) {
  return String(pi.description || '').trim() || (pi.invoice ? 'Оплата по счёту' : 'Оплата в Stripe');
}

// Всё, что Stripe провёл за N дней, рядом с тем, что об этом знает наша база.
export async function listStripePayments(days = 30) {
  const since = Math.floor(Date.now() / 1000) - Number(days || 30) * 86400;
  const list = await stripe.paymentIntents.list({ limit: 100, created: { gte: since } });
  const paid = (list.data || []).filter(pi => pi.status === 'succeeded');

  const known = new Map();

  for (const record of await kvMGet(await kvKeys('payment:*'))) {
    if (record && record.pi) known.set(String(record.pi), record);
  }

  const skipped = await skippedIds();
  const bookings = [];

  for (const booking of await kvMGet(await kvKeys('booking:*'))) {
    if (booking && booking.id && booking.status !== 'cancelled') bookings.push(booking);
  }

  const rows = [];

  for (const pi of paid) {
    const record = known.get(pi.id) || null;
    const skip = skipped.has(pi.id);
    // Почту спрашиваем только у непривязанных: у привязанных она уже записана,
    // а каждый такой вопрос — отдельный запрос в Stripe.
    // 07.10.2026: запись без заявки (оплата с сайта) раньше считалась «привязанной»,
    // и кнопки «Привязать» у неё не было. Привязанной считаем только запись с заявкой.
    const hasBooking = Boolean(record && record.bookingId);
    const email = (record && record.email) ? String(record.email) : await payerEmail(pi);
    const guess = (hasBooking || skip) ? null : matchBooking(email, bookings);

    rows.push({
      id: pi.id,
      at: new Date(pi.created * 1000).toISOString(),
      amount: pi.amount_received || pi.amount || 0,
      currency: String(pi.currency || 'eur').toUpperCase(),
      label: paymentLabel(pi),
      invoice: Boolean(pi.invoice),
      email,
      bookingId: record ? (record.bookingId || null) : null,
      linked: hasBooking,
      recorded: Boolean(record),
      skipped: skip,
      guessId: guess ? guess.id : '',
      guessName: guess ? (guess.name || 'без имени') : ''
    });
  }

  rows.sort((a, b) => (a.at < b.at ? 1 : -1));

  return rows;
}

// Оплаты Stripe, которых нет в базе вообще: до 10.10.2026 вебхук молча выбрасывал
// платежи, не совпавшие ни с одной заявкой, и в аналитике органика была пустой.
// Дописываем их как органику (без заявки). Привязать к заявке можно и потом.
export async function recordUnlinked(rows) {
  let added = 0;

  for (const row of rows || []) {
    if (row.recorded) continue;

    await kvSet('payment:pi_' + row.id, {
      at: row.at,
      bookingId: null,
      pi: row.id,
      email: row.email || '',
      label: row.label,
      amount: row.amount,
      currency: String(row.currency || 'eur').toLowerCase(),
      via: 'Stripe'
    });
    row.recorded = true;
    added++;
  }

  return added;
}

// Привязка руками из админки: платёж есть в Stripe, заявку называет менеджер.
export async function attachPayment(piId, bookingId, by) {
  const id = String(piId || '').trim();

  if (!/^pi_[A-Za-z0-9]+$/.test(id)) return { ok: false, error: 'Неверный код платежа' };

  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена: ' + bookingId };

  let pi;

  try {
    pi = await stripe.paymentIntents.retrieve(id);
  } catch (e) {
    return { ok: false, error: 'Stripe не отдал платёж: ' + e.message };
  }

  if (!pi || pi.status !== 'succeeded') return { ok: false, error: 'Этот платёж в Stripe не прошёл' };

  // Один и тот же платёж, привязанный дважды, удвоит выручку в отчёте.
  // Заодно ищем ручную отметку по этой же заявке — она про эти же деньги.
  const keys = await kvKeys('payment:*');
  const records = await kvMGet(keys);
  const manual = [];
  const amount = pi.amount_received || pi.amount || 0;
  // Запись об этом платеже уже есть, но без заявки: оплата пришла с сайта,
  // вебхук её записал, а с человеком не связал. Дописываем заявку в неё же.
  let existingKey = null;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (!record) continue;
    if (record.pi === id) {
      if (record.bookingId) {
        return { ok: false, error: 'Платёж уже привязан к заявке ' + record.bookingId };
      }
      existingKey = keys[i];
      continue;
    }
    // Ручная отметка про ЭТИ ЖЕ деньги: та же заявка и та же сумма. Раньше
    // удалялись все ручные отметки заявки, вместе с оплатой интро.
    if (record.bookingId === booking.id && String(keys[i]).startsWith('payment:manual_')
        && Number(record.amount || 0) === Number(amount)) {
      manual.push(keys[i]);
    }
  }

  const email = await payerEmail(pi);
  const at = new Date(pi.created * 1000).toISOString();
  const label = paymentLabel(pi);

  await kvSet(existingKey || ('payment:pi_' + id), {
    at,
    bookingId: booking.id,
    pi: id,
    email,
    label,
    amount,
    currency: pi.currency || 'eur',
    via: 'Stripe'
  });

  // Ту же оплату могли провести руками как «мимо кассы», пока её не было видно.
  // Оставить обе записи — значит посчитать деньги дважды.
  for (const key of manual) await kvDel(key);

  // Привязали осознанно — значит, метка «не наша» с неё снимается.
  await kvDel(SKIP + id);

  await updateBooking(booking.id, {
    paid: true,
    paidAt: at,
    paidAmount: amount,
    paidCurrency: pi.currency || 'eur',
    paidPack: label,
    paidVia: 'stripe',
    paidPi: id,
    paidBy: '@' + by,
    ...paidAccumulation(booking, amount)
  });

  // Purchase шлём только если платёж раньше вообще не был записан. Если запись была,
  // вебхук уже отправил его в Мету при оплате, и второй раз он задвоит покупки.
  if (!existingKey) {
    try {
      await sendPurchase({
        bookingId: booking.id,
        email: email || booking.email,
        value: amount / 100,
        currency: String(pi.currency || 'eur').toUpperCase(),
        contentName: label,
        orderId: id,
        eventId: 'stripe_pi_' + id
      });
    } catch (e) {
      console.error('CAPI purchase error:', e);
    }
  }

  await notifyManagers(
    '💰 <b>Оплата привязана к заявке</b>\n' +
    (booking.name || 'без имени') + ' · <code>' + booking.id + '</code>\n' +
    label + ' — ' + Math.round(amount / 100) + ' ' + String(pi.currency || 'eur').toUpperCase() +
    (email ? '\n' + email : '') +
    '\nПривязал @' + by +
    (manual.length ? '\nРучная отметка «мимо кассы» убрана, чтобы деньги не посчитались дважды.' : '')
  );

  return {
    ok: true,
    message: 'Оплата привязана' + (manual.length ? ' · ручная отметка убрана' : '')
  };
}

// Обратное действие: оплата к воронке отношения не имеет. Так бывает со счетами
// постоянным ученикам — почта та же, а деньги не за пробный урок. Просто удалить
// запись мало: следующая сверка привяжет её заново, поэтому ставим метку.
export async function detachPayment(piId, by) {
  const id = String(piId || '').trim();

  if (!/^pi_[A-Za-z0-9]+$/.test(id)) return { ok: false, error: 'Неверный код платежа' };

  const keys = await kvKeys('payment:*');
  const records = await kvMGet(keys);
  let bookingId = null;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (!record || record.pi !== id) continue;
    bookingId = record.bookingId || null;
    await kvDel(keys[i]);
  }

  // В заявке отметка об оплате осталась бы висеть и после отвязки.
  // Снимаем её только если она пришла именно из этого платежа.
  if (bookingId) {
    const booking = await getBooking(bookingId);

    if (booking && booking.paidPi === id) {
      await updateBooking(bookingId, {
        paid: false,
        paidAt: null,
        paidAmount: null,
        paidCurrency: null,
        paidVia: null,
        paidPi: null,
        paidBy: null
      });
    }
  }

  await kvSet(SKIP + id, { at: new Date().toISOString(), by: '@' + by, bookingId });

  await notifyManagers(
    '↩️ <b>Оплата отвязана от воронки</b>\n' +
    '<code>' + id + '</code>' +
    (bookingId ? '\nБыла привязана к заявке <code>' + bookingId + '</code>' : '') +
    '\nОтвязал @' + by + '. Больше её не подберут ни вебхук, ни сверка.'
  );

  return { ok: true, message: 'Оплата отвязана' + (bookingId ? ' от заявки ' + bookingId : '') };
}

// Передумали: метку снимаем, оплата снова участвует в сверке.
export async function unskipPayment(piId) {
  const id = String(piId || '').trim();

  if (!/^pi_[A-Za-z0-9]+$/.test(id)) return { ok: false, error: 'Неверный код платежа' };

  await kvDel(SKIP + id);

  return { ok: true, message: 'Оплата вернулась в сверку' };
}
