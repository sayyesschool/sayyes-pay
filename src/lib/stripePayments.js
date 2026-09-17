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
    const email = record ? String(record.email || '') : await payerEmail(pi);
    const guess = (record || skip) ? null : matchBooking(email, bookings);

    rows.push({
      id: pi.id,
      at: new Date(pi.created * 1000).toISOString(),
      amount: pi.amount_received || pi.amount || 0,
      currency: String(pi.currency || 'eur').toUpperCase(),
      label: paymentLabel(pi),
      invoice: Boolean(pi.invoice),
      email,
      bookingId: record ? (record.bookingId || null) : null,
      linked: Boolean(record),
      skipped: skip,
      guessId: guess ? guess.id : '',
      guessName: guess ? (guess.name || 'без имени') : ''
    });
  }

  rows.sort((a, b) => (a.at < b.at ? 1 : -1));

  return rows;
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

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (!record) continue;
    if (record.pi === id) {
      return { ok: false, error: 'Платёж уже привязан к заявке ' + (record.bookingId || '—') };
    }
    if (record.bookingId === booking.id && String(keys[i]).startsWith('payment:manual_')) {
      manual.push(keys[i]);
    }
  }

  const amount = pi.amount_received || pi.amount || 0;
  const email = await payerEmail(pi);
  const at = new Date(pi.created * 1000).toISOString();
  const label = paymentLabel(pi);

  await kvSet('payment:pi_' + id, {
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
    paidPack: booking.paidPack || label,
    paidVia: 'stripe',
    paidPi: id,
    paidBy: '@' + by
  });

  try {
    await sendPurchase({ ...booking, paid: true, paidAmount: amount, paidPack: booking.paidPack || label });
  } catch (e) {
    console.error('CAPI purchase error:', e);
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
