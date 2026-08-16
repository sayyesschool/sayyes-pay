// Meta Conversions API — серверные события.
//
// Цикл сделки 7–30 дней, поэтому оптимизация идёт по событию дня 0 (Lead, дальше
// Schedule), а Purchase уходит для измерения и аудиторий — он структурно вне
// семидневного окна атрибуции и доставку не поведёт.
//
// Каждое событие дублируется браузером и сервером с одинаковым event_id:
// браузерное ловит тех, у кого не режется пиксель, серверное — остальных,
// Мета склеивает их по event_id и считает один раз.
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
// Воронка делает это в момент клика — там таймстамп честный; здесь запасной вариант.
function deriveFbc(attribution) {
  if (!attribution) return null;
  if (attribution.fbc) return attribution.fbc;
  if (!attribution.fbclid) return null;
  return `fb.1.${Date.now()}.${attribution.fbclid}`;
}

// fbc, fbp, ip и user-agent НЕ хешируются — частая ошибка, из-за которой
// падает Event Match Quality.
function buildUserData({ email, phone, name, externalId, attribution }) {
  const attr = attribution || {};
  const userData = {};
  const em = hashEmail(email);
  const ph = hashPhone(phone);
  const fn = hashName(name ? String(name).split(' ')[0] : null);
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (fn) userData.fn = [fn];
  if (attr.fbp) userData.fbp = attr.fbp;
  const fbc = deriveFbc(attr);
  if (fbc) userData.fbc = fbc;
  if (externalId) userData.external_id = [sha256(externalId)];
  if (attr.ip) userData.client_ip_address = attr.ip;
  if (attr.ua) userData.client_user_agent = attr.ua;
  return userData;
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

// Единая отправка. Никогда не бросает наружу — аналитика не должна ронять заявку.
export async function sendCapiEvent({
  eventName,
  eventId,
  eventTime,
  actionSource = 'website',
  sourceUrl,
  email,
  phone,
  name,
  externalId,
  attribution,
  customData
}) {
  const token = CAPI_TOKEN();
  if (!token) return { skipped: 'no META_CAPI_TOKEN' };

  try {
    const userData = buildUserData({ email, phone, name, externalId, attribution });

    // Без единого идентификатора событие бесполезно — Мета его не сматчит.
    if (!userData.em && !userData.ph && !userData.fbp && !userData.fbc) {
      return { skipped: 'no identifiers', eventName };
    }

    const event = {
      event_name: eventName,
      event_time: eventTime || Math.floor(Date.now() / 1000),
      action_source: actionSource,
      user_data: userData,
      custom_data: customData || {}
    };
    if (eventId) event.event_id = String(eventId);
    // Для system_generated страница не обязательна и Мета её игнорирует
    if (sourceUrl && actionSource !== 'system_generated') event.event_source_url = sourceUrl;

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
      console.error(`CAPI ${eventName} error:`, resp.status, data);
      return { ok: false, eventName, status: resp.status, data };
    }
    return { ok: true, eventName, data };
  } catch (e) {
    console.error(`CAPI ${eventName} failed:`, e);
    return { ok: false, eventName, error: String(e) };
  }
}

/**
 * Lead — запись на пробный урок оформлена. Оптимизация, этап 1.
 * Браузер шлёт такое же событие с тем же eventId, Мета склеит их в одно.
 */
export async function sendLead(booking, extra = {}) {
  if (!booking) return { skipped: 'no booking' };
  const answers = booking.quizAnswers || {};
  return sendCapiEvent({
    eventName: 'Lead',
    eventId: booking.leadEventId,
    externalId: booking.id,
    email: booking.email,
    phone: booking.telegram,
    name: booking.name,
    attribution: booking.attribution,
    sourceUrl: extra.sourceUrl || (booking.attribution && booking.attribution.landing_url),
    customData: {
      content_name: 'trial_booking',
      content_category: (booking.attribution && booking.attribution.landing) || 'funnel',
      lead_level: answers['Уровень'] || '',
      lead_goal: answers['Цель'] || '',
      lead_country: answers['Страна'] || '',
      lead_format: answers['Формат'] || '',
      value: 0,
      currency: 'EUR'
    }
  });
}

/**
 * Schedule — человек подтвердил запись в боте. Оптимизация, этап 2.
 * hours_to_lesson нужен, чтобы проверить гипотезу «чем ближе слот, тем выше доходимость».
 */
export async function sendSchedule(booking, extra = {}) {
  if (!booking) return { skipped: 'no booking' };
  const custom = {
    content_name: 'trial_confirmed',
    value: 0,
    currency: 'EUR'
  };
  if (extra.slotIso) custom.slot_datetime = extra.slotIso;
  if (typeof extra.hoursToLesson === 'number') custom.hours_to_lesson = extra.hoursToLesson;
  return sendCapiEvent({
    eventName: 'Schedule',
    eventId: booking.scheduleEventId || (booking.id ? 'sch_' + booking.id : undefined),
    externalId: booking.id,
    email: booking.email,
    phone: booking.telegram,
    name: booking.name,
    attribution: booking.attribution,
    sourceUrl: extra.sourceUrl || 'https://www.sayyestoenglish.com/learn_easy',
    customData: custom
  });
}

/**
 * Purchase — фактическая оплата, обычно через 7–30 дней после клика.
 * action_source именно system_generated: отдельный Offline Conversions API
 * закрыт в мае 2025, серверные события идут через обычный CAPI с этим значением.
 */
export async function sendPurchase(p = {}) {
  const found = await findAttributionByContact({ email: p.email, phone: p.phone });
  const booking = (found && found.booking) || null;
  const attribution = (found && found.attribution) || {};

  return sendCapiEvent({
    eventName: 'Purchase',
    eventId: p.eventId,
    actionSource: 'system_generated',
    email: p.email,
    phone: p.phone || (booking && booking.telegram),
    name: booking && booking.name,
    externalId: booking && booking.id,
    attribution,
    customData: {
      value: Number(p.value) || 0,
      currency: (p.currency || 'EUR').toUpperCase(),
      ...(p.contentName ? { content_name: String(p.contentName) } : {}),
      ...(p.orderId ? { order_id: String(p.orderId) } : {})
    }
  });
}
