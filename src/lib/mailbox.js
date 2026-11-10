import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getBooking, updateBooking, kvGet, kvSet, kvKeys, kvMGet } from '@/lib/redis';
import { addMessage } from '@/lib/thread';
import { sendMessage } from '@/lib/telegram';
import { notifyManagers } from '@/lib/managers';
import { INFO_MAIL } from '@/lib/email';

// Ответы учеников на письма цепочки (10.11.2026). Письма уходят от info@, ответы
// приходят в ящик info@ в Zoho Mail. Менеджеры в Zoho не работают: сайт сам
// забирает новые письма по IMAP (раз в ~5 минут, вместе с кроном напоминаний),
// привязывает их к ученику и кладёт в переписку карточки.
//
// Правила:
// - ящик только читаем: письма остаются непрочитанными, ничего не двигаем и не удаляем;
// - читаем только новое: помним последний UID во «Входящих»;
// - письмо, которое не привязалось ни к одному ученику, не сохраняем вообще.
//
// Привязка: 1) In-Reply-To / References содержат наш Message-ID «sy.<код заявки>.…»;
// 2) адрес отправителя совпадает с почтой заявки, по которой шла переписка письмами
// или запускалась цепочка оффера.

const STATE_KEY = 'mailsync:state';
const HOST = () => process.env.ZOHO_IMAP_HOST || 'imap.zoho.eu';
const USER = () => process.env.ZOHO_IMAP_USER || '';
const PASS = () => process.env.ZOHO_IMAP_PASSWORD || '';
const SITE = 'https://www.sayyestoenglish.com';
const MAX_PER_RUN = 30;

export function mailboxEnabled() {
  return Boolean(USER() && PASS());
}

const norm = v => String(v || '').trim().toLowerCase();

// Срезаем процитированную переписку: в карточке нужен ответ, а не вся история.
export function stripQuoted(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];

  for (const line of lines) {
    const l = line.trim();

    if (/^>/.test(l)) break;
    if (/^(On|Le|Am|El)\s.+(wrote|écrit|schrieb|escribió):?$/i.test(l)) break;
    if (/(пишет|написал|написала)\s*:?$/i.test(l) && /\d/.test(l)) break;
    // Gmail по-русски: «Вт, 10 нояб. 2026 г. в 12:00, Кристина | Say Yes! <info@…>:»
    if (/<[^>]+@[^>]+>:?$/.test(l) && /\d/.test(l)) break;
    if (/^-{2,}\s*(Original Message|Исходное сообщение|Пересылаемое сообщение)/i.test(l)) break;
    if (/^-{4}\s*On\s/i.test(l) || /^={3,}/.test(l)) break;
    if (/^(From|От|Отправлено|Sent):\s/i.test(l) && out.length) break;
    out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function bookingFromHeaders(parsed) {
  const refs = [
    parsed.inReplyTo || '',
    ...(Array.isArray(parsed.references) ? parsed.references : [parsed.references || ''])
  ].join(' ');
  const m = refs.match(/sy\.([a-z0-9]{4,16})\./);

  return m ? m[1] : null;
}

async function bookingFromSender(email) {
  if (!email) return null;

  const keys = await kvKeys('booking:*');
  const all = (await kvMGet(keys)).filter(b => b && norm(b.email) === email && (b.offer || b.mailThread));

  if (!all.length) return null;

  all.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  return all[0].id;
}

async function notifyNewReply(booking, snippet) {
  const text = '✉️ <b>Ответ на письмо</b> от ' + (booking.name || 'ученика') + ' (' + booking.email + '):\n\n'
    + snippet.slice(0, 600) + (snippet.length > 600 ? '…' : '')
    + '\n\nКарточка: ' + SITE + '/admin/client/' + booking.id;
  const group = await kvGet('clients_chat_id');

  if (group) {
    const res = await sendMessage(group, text);

    if (res && res.ok) return;
  }

  await notifyManagers(text);
}

async function handleMessage(source) {
  const parsed = await simpleParser(source);
  const fromAddr = parsed.from && parsed.from.value && parsed.from.value[0] ? norm(parsed.from.value[0].address) : '';

  // Свои письма, рассылки и автоответы не трогаем.
  if (!fromAddr || fromAddr === norm(INFO_MAIL()) || /sayyestoenglish\.com$/.test(fromAddr)) return null;
  if (/^(mailer-daemon|postmaster|no-?reply)/.test(fromAddr)) return null;

  const auto = parsed.headers && (parsed.headers.get('auto-submitted') || parsed.headers.get('x-autoreply'));

  if (auto && String(auto).toLowerCase() !== 'no') return null;

  const bookingId = bookingFromHeaders(parsed) || await bookingFromSender(fromAddr);

  if (!bookingId) return null;

  const booking = await getBooking(bookingId);

  if (!booking) return null;

  const body = stripQuoted(parsed.text || '') || '(письмо без текста)';
  const subject = parsed.subject || '';

  await addMessage(booking.id, { from: 'student', channel: 'email', subject, text: body });

  const patch = {
    mailThread: true,
    mailLastInboundId: parsed.messageId || null,
    mailLastReferences: Array.isArray(parsed.references) ? parsed.references.join(' ') : (parsed.references || null),
    mailLastSubject: subject || booking.mailLastSubject || null,
    mailLastInboundAt: new Date().toISOString()
  };

  // Ответ ученика ставит цепочку оффера на паузу: дальше пишет менеджер.
  if (booking.offer && !booking.offer.paused && !booking.offer.stopped && !booking.offer.done) {
    patch.offer = { ...booking.offer, paused: true, pausedAt: new Date().toISOString(), pauseReason: 'email_reply' };
  }

  await updateBooking(booking.id, patch);
  await notifyNewReply(booking, body);

  return booking.id;
}

export async function syncInbox() {
  if (!mailboxEnabled()) return { skipped: 'no credentials' };

  const client = new ImapFlow({
    host: HOST(), port: 993, secure: true,
    auth: { user: USER(), pass: PASS() },
    logger: false,
    socketTimeout: 20000
  });
  const result = { checked: 0, matched: 0 };

  try {
    await client.connect();

    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    const state = (await kvGet(STATE_KEY)) || {};
    const uidValidity = String(box.uidValidity);

    // Первый запуск или ящик пересоздан: старые письма не разбираем, начинаем с текущего.
    if (!state.lastUid || state.uidValidity !== uidValidity) {
      await kvSet(STATE_KEY, { uidValidity, lastUid: Math.max(0, Number(box.uidNext) - 1), at: new Date().toISOString() });
      return { ...result, initialized: true };
    }

    let lastUid = Number(state.lastUid);
    const range = (lastUid + 1) + ':*';

    for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
      if (msg.uid <= lastUid) continue;
      result.checked++;

      try {
        if (await handleMessage(msg.source)) result.matched++;
      } catch (e) {
        console.error('Mailbox message error:', msg.uid, e);
      }

      lastUid = msg.uid;
      if (result.checked >= MAX_PER_RUN) break;
    }

    await kvSet(STATE_KEY, { uidValidity, lastUid, at: new Date().toISOString() });

    return result;
  } catch (e) {
    console.error('Mailbox sync error:', e);
    await kvSet('mailsync:error', { at: new Date().toISOString(), error: String(e && e.message || e).slice(0, 300) }, 60 * 60 * 24 * 7);

    return { ...result, error: String(e && e.message || e).slice(0, 200) };
  } finally {
    try { await client.logout(); } catch (e) { /* соединение уже закрыто */ }
  }
}
