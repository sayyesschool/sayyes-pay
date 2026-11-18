import { stripe } from '@/services/stripe';
import { kvGet, kvSet } from '@/lib/redis';

// Комиссия Stripe и возвраты по платежу (18.11.2026, когортный анализ: выручка
// «за вычетом комиссии Stripe»). Записи об оплате (payment:*) хранят только сумму,
// поэтому комиссию и возвраты спрашиваем у Stripe по payment_intent и кладём в кэш:
// старые платежи на 30 дней, свежие на сутки (возврат может случиться позже).
const KEY = pi => 'stripefee:' + pi;
const DAY = 24 * 60 * 60;

async function fetchOne(pi) {
  const intent = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge.balance_transaction'] });
  const charge = intent && intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const bt = charge && charge.balance_transaction && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;

  return {
    fee: bt ? Number(bt.fee || 0) : 0,
    refunded: charge ? Number(charge.amount_refunded || 0) : 0,
    feeKnown: Boolean(bt),
    at: new Date().toISOString()
  };
}

// payments: записи из loadPayments(). Возвращает Map pi -> { fee, refunded }.
export async function stripeCosts(payments) {
  const out = new Map();
  const pis = [...new Set(payments.filter(p => p.via === 'Stripe' && p.pi).map(p => String(p.pi)))];
  const missing = [];

  for (const pi of pis) {
    const cached = await kvGet(KEY(pi));

    if (cached) out.set(pi, cached);
    else missing.push(pi);
  }

  // Не больше 40 запросов к Stripe за одно открытие: остальное догрузится в следующий раз.
  const batch = missing.slice(0, 40);

  for (let i = 0; i < batch.length; i += 5) {
    await Promise.all(batch.slice(i, i + 5).map(async pi => {
      try {
        const rec = await fetchOne(pi);
        const pay = payments.find(p => String(p.pi) === pi);
        const old = pay && Date.now() - new Date(pay.at).getTime() > 14 * DAY * 1000;

        await kvSet(KEY(pi), rec, old ? 30 * DAY : DAY);
        out.set(pi, rec);
      } catch (e) {
        console.error('Stripe fee fetch error:', pi, e.message || e);
      }
    }));
  }

  return { costs: out, pending: Math.max(0, missing.length - batch.length) + batch.filter(pi => !out.has(pi)).length };
}
