// Meta Conversions API — серверный Purchase.
//
// Оплата приходит вебхуком, то есть в браузере в этот момент никого нет и пиксель
// сработать не может. Без серверного события Мета не знает, какая реклама принесла
// деньги, и оптимизирует показы вслепую — по заявкам, а не по оплатам.
//
// Матчинг делается по хешам почты и телефона из заявки, плюс _fbp/_fbc/fbclid,
// которые воронка сохраняет вместе с заявкой (см. ATTRIBUTION в learn_easy.html).
//
// Всё под флагом: без META_CAPI_TOKEN модуль молча ничего не делает.

import crypto from 'crypto';
import { kvGet, kvKeys } from '@/lib/redis';

const PIXEL_ID = () => process.env.META_PIXEL_ID || '1405840230688968';
const CAPI_TOKEN = () => process.env.META_CAPI_TOKEN;
const TEST_EVENT_CODE = () => process.env.META_TEST_EVENT_CODE || '';
const GRAPH_VERSION = 'v21.0';

export function capiEnabled() {
  return !!CAPI_TOKEN();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// Мета требует нормализацию до хеширования: нижний регистр, без пробелов.
function hashEmail(email) {
  if (!email) return null;
  const norm = String(email).trim().toLowerCase();
  return norm.includes('@') ? sha256(norm) : null;
}

// Телефон — только цифры, с кодом страны, без плюса.
function hashPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 8 ? sha256(digits) : null;
}

function hashName(name) {
  if (!name) return null;
  const norm = String(name).trim().toLowerCase();
  return norm ? sha256(norm) : null;
}

// _fbc собирается из fbclid по формату Меты, если куки не досталось.
function deriveFbc(attribution) {
  if (!attribution) return null;
  if (attribution.fbc) return attribution.fbc;
  if (!attribution.fbclid) return null;
  return `fb.1.${Date.now()}.${attribution.fbclid}`;
}

// Ищем заявку по почте или телефону, чтобы достать идентификаторы клика.
// Оплата и заявка — разные события, связать их можно только по контакту.
export async function findAttributionByContact({ email, phone }) {
  const normEmail = email ? String(email).trim().toLowerCase() : '';
  const normPhone = phone ? String(phone).replace(/\D/g, '') : '';
  if (!normEmail && !normPhone) return null;

  try {
    const keys = await kvKeys('booking:*');
    let best = null;
    for (const key of keys) {
      const b = await kvGet(key);
      if (!b || !b.id) continue;
      const bEmail = (b.email || '').trim().toLowerCase();
      const bPhone = (b.telegram || '').replace(/\D/g, '');
      const match = (normEmail && bEmail === normEmail) ||
        (normPhone && bPhone && bPhone === normPhone);
      if (!match) continue;
      if (!best || (b.createdAt || '') > (best.createdAt || '')) best = b;
    }
    if (!best) return null;
    return { booking: best, attribution: best.attribution || {} };
  } catch (e) {
    console.error('findAttributionByContact error:', e);
    return null;
  }
}

/**
 * Отправляет Purchase в Conversions API.
 * Никогда не бросает наружу — оплата важнее аналитики.
 *
 * @param {object} p
 * @param {string} p.email        почта плательщика
 * @param {string} [p.phone]      телефон, если известен
 * @param {number} p.value        сумма
 * @param {string} p.currency     валюта, например 'EUR'
 * @param {string} [p.eventId]    для дедупликации с браузерным событием
 * @param {string} [p.sourceUrl]  страница оплаты
 * @param {string} [p.contentName] что купили
 */
export async function sendPurchase(p = {}) {
  const token = CAPI_TOKEN();
  if (!token) return { skipped: 'no META_CAPI_TOKEN' };

  try {
    const found = await findAttributionByContact({ email: p.email, phone: p.phone });
    const attribution = (found && found.attribution) || {};
    const booking = (found && found.booking) || null;

    const userData = {};
    const em = hashEmail(p.email);
    const ph = hashPhone(p.phone || (booking && booking.telegram));
    const fn = hashName(booking && booking.name ? String(booking.name).split(' ')[0] : null);
    if (em) userData.em = [em];
    if (ph) userData.ph = [ph];
    if (fn) userData.fn = [fn];
    if (attribution.fbp) userData.fbp = attribution.fbp;
    const fbc = deriveFbc(attribution);
    if (fbc) userData.fbc = fbc;
    if (booking && booking.id) userData.external_id = [sha256(booking.id)];

    // Без единого идентификатора событие бесполезно — Мета его не сматчит.
    if (!userData.em && !userData.ph && !userData.fbp && !userData.fbc) {
      return { skipped: 'no identifiers' };
    }

    const event = {
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: p.sourceUrl || 'https://www.sayyestoenglish.com/',
      user_data: userData,
      custom_data: {
        value: Number(p.value) || 0,
        currency: (p.currency || 'EUR').toUpperCase()
      }
    };
    if (p.eventId) event.event_id = String(p.eventId);
    if (p.contentName) event.custom_data.content_name = String(p.contentName);

    const body = { data: [event] };
    if (TEST_EVENT_CODE()) body.test_event_code = TEST_EVENT_CODE();

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID()}/events?access_token=${encodeURIComponent(token)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('CAPI Purchase error:', resp.status, data);
      return { ok: false, status: resp.status, data };
    }
    return { ok: true, matched: !!booking, data };
  } catch (e) {
    console.error('CAPI Purchase failed:', e);
    return { ok: false, error: String(e) };
  }
}
