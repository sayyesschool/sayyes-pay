import { ZOOM_JOIN_URL, ZOOM_MEETING_ID, ZOOM_PASSCODE } from '@/lib/zoom';
// Письмо с подтверждением записи.
//
// Раньше подтверждение существовало только двумя способами: экран после записи и
// сообщение в Telegram — а Telegram доходил лишь до тех, кто нажал «Начать» в боте.
// Почта закрывает этот разрыв: письмо уходит сразу и не зависит ни от чего.
//
// Провайдер выбирается по тому, какой ключ задан. Сделано так, потому что домен
// сейчас на DNS Wix, где нельзя завести MX на субдомене, а Resend его требует.
// Postmark, ZeptoMail и SendGrid обходятся TXT и CNAME и работают уже сегодня;
// после переезда зоны на Cloudflare достаточно задать RESEND_API_KEY — код тот же.
//
// Приоритет: POSTMARK_TOKEN → ZEPTOMAIL_TOKEN → SENDGRID_API_KEY → RESEND_API_KEY.
// Не задан ни один — модуль молча ничего не делает и никогда не роняет запись.

import { localSlot, tzNoteFor } from '@/lib/time';
import { kvSet } from '@/lib/redis';

const BOT_LINK_BASE = 'https://t.me/SY_school_bot';

const MAIL_FROM = () => process.env.MAIL_FROM || 'SAY YES <hello@sayyestoenglish.com>';
const MAIL_REPLY_TO = () => process.env.MAIL_REPLY_TO || '';

function provider() {
  if (process.env.POSTMARK_TOKEN) return 'postmark';
  if (process.env.ZEPTOMAIL_TOKEN) return 'zeptomail';
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  if (process.env.RESEND_API_KEY) return 'resend';
  return null;
}

export function emailEnabled() {
  return !!provider();
}

// Нужно для диагностики: молчаливый отказ отправки иначе никак не виден снаружи.
export function mailProvider() {
  return provider();
}

// «SAY YES <hello@sayyestoenglish.com>» → { name, email }
function parseFrom(value) {
  const m = String(value).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, ''), email: m[2] };
  return { name: '', email: String(value).trim() };
}

// --- .ics ---
// Ключ слота — «2026-08-28_19:00» в базовом поясе расписания (UTC+3) → в UTC минус 3 часа.
// В ICS запятая, точка с запятой и перевод строки — служебные символы, их экранируем.
function icsEscape(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export function buildIcs(slotKey, bookingId) {
  if (!slotKey || slotKey === 'no_time') return null;
  const [datePart, timePart] = String(slotKey).split('_');
  if (!datePart || !timePart) return null;
  const [y, mo, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  if ([y, mo, d, hh, mm].some(n => Number.isNaN(n))) return null;

  const startUtc = new Date(Date.UTC(y, mo - 1, d, hh - 3, mm));
  const endUtc = new Date(startUtc.getTime() + 30 * 60 * 1000);
  const stamp = dt => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SAY YES English School//learn_easy//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + (bookingId || 'sayyes') + '@sayyestoenglish.com',
    'DTSTAMP:' + stamp(new Date()),
    'DTSTART:' + stamp(startUtc),
    'DTEND:' + stamp(endUtc),
    'SUMMARY:Пробный урок английского — SAY YES',
    'DESCRIPTION:' + icsEscape(
      'Пробный урок 30 минут в Zoom.\n' +
      'Подключиться: ' + ZOOM_JOIN_URL + '\n' +
      'Идентификатор конференции: ' + ZOOM_MEETING_ID + '\n' +
      'Код доступа: ' + ZOOM_PASSCODE
    ),
    'LOCATION:' + icsEscape(ZOOM_JOIN_URL),
    'URL:' + ZOOM_JOIN_URL,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Пробный урок английского через час',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

// Ответы из воронки лежат в booking.quizAnswers с теми же ключами, что на экранах.
// Общая фраза «аптека, врач, школа ребёнка или работа» звучала странно именно потому,
// что перечисляла всё сразу. Берём цель человека и говорим про неё одну.
const GOAL_LINES = [
  [/карьер|работ/i, 'разберём рабочую ситуацию: созвон, письмо или короткая презентация'],
  [/переезд|за границей/i, 'разберём бытовую ситуацию: приём у врача, аренда, школа ребёнка'],
  [/свободное общение/i, 'поговорим на бытовые темы — те, что встречаются каждый день'],
  [/уч[её]б/i, 'разберём учебную ситуацию: лекция, статья или экзамен'],
  [/закрыть этот вопрос/i, 'начнём с того, что даётся тяжелее всего']
];

function lessonLine(booking) {
  const goal = (booking.quizAnswers && booking.quizAnswers['Цель']) || '';
  for (const [re, line] of GOAL_LINES) {
    if (re.test(goal)) return line;
  }
  return 'разберём ситуацию, которая ближе всего к вашей задаче';
}

// «Преподаватель заранее знает ваш уровень» — только если уровень действительно есть
function levelLine(booking) {
  const level = (booking.quizAnswers && booking.quizAnswers['Уровень']) || '';
  if (!level) return '';
  return `Ваши ответы мы передадим преподавателю — на уроке он определит ваш текущий уровень и цели.`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function layout(inner) {
  return `<!DOCTYPE html><html lang="ru"><body style="margin:0;padding:0;background:#f7f7f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;padding:28px 24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a">
<tr><td style="font-size:18px;font-weight:800;color:#5B2D8E;letter-spacing:.02em;padding-bottom:18px">SAY YES! <span style="font-weight:500;color:#666;font-size:13px">English School</span></td></tr>
${inner}
<tr><td style="padding-top:22px;border-top:1px solid #eee;font-size:12px;color:#888;line-height:1.6">
Если письмо пришло по ошибке — просто не отвечайте на него.<br>
SAY YES English School · <a href="https://www.sayyestoenglish.com/" style="color:#5B2D8E">sayyestoenglish.com</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

function confirmationHtml(booking, mode) {
  const hasSlot = booking.slot && booking.slot !== 'no_time';
  const name = booking.name ? String(booking.name).split(' ')[0] : '';
  const greeting = name ? `, ${esc(name)}` : '';
  // Время всегда в поясе клиента. Пояс неизвестен — считаем по CET и помечаем это.
  const local = localSlot(booking);
  const clientTime = (local && local.time) || booking.slotLocal || '';
  const clientDate = (local && local.date) || booking.slotDate || '—';
  const timeLabel = (local && local.assumed) ? 'Время (CET)' : 'Время';
  const tzNote = tzNoteFor(booking);
  const botLink = `${BOT_LINK_BASE}?start=${encodeURIComponent(booking.id || '')}`;

  const when = hasSlot
    ? `<tr><td style="padding-bottom:18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EDFA;border-radius:14px;padding:16px">
<tr><td style="font-size:13px;color:#3D1B5E;line-height:1.9">
<b>Дата:</b> ${esc(clientDate)}<br>
<b>${timeLabel}:</b> ${esc(clientTime || '—')}<br>
<b>Формат:</b> пробный урок · 30 минут · Zoom${tzNote ? `<br>
<span style="color:#6b4b8a">Время указано ${esc(tzNote)}</span>` : ''}
</td></tr></table></td></tr>`
    : `<tr><td style="padding-bottom:18px;font-size:14px;line-height:1.6;color:#444">
Мы подберём удобное время и напишем вам в течение рабочего дня.</td></tr>`;

  const title = mode === 'reschedule'
    ? `Запись перенесена${greeting}!`
    : (hasSlot ? `Вы записаны${greeting}!` : `Заявка принята${greeting}!`);

  return layout(`
<tr><td style="font-size:22px;font-weight:800;line-height:1.3;padding-bottom:14px">${title}</td></tr>
${when}
<tr><td style="font-size:14px;line-height:1.7;color:#444;padding-bottom:18px">
<b>Что дальше</b><br>
✔ Ссылка на урок: <a href="${ZOOM_JOIN_URL}" style="color:#5B2D8E;font-weight:700">подключиться в Zoom</a><br>
<span style="color:#6b4b8a">Идентификатор ${ZOOM_MEETING_ID}, код доступа ${ZOOM_PASSCODE} — если заходите из приложения</span><br>
✔ Перенести или отменить можно в любой момент
</td></tr>
${levelLine(booking) ? `<tr><td style="padding-bottom:18px;font-size:13px;color:#666;line-height:1.6">${levelLine(booking)}</td></tr>` : ''}
${hasSlot ? `<tr><td style="padding-bottom:18px;font-size:13px;color:#666;line-height:1.6">
Файл во вложении добавляет урок в календарь с напоминанием за час.</td></tr>` : ''}
<tr><td style="padding-bottom:6px">
<a href="${botLink}" style="display:inline-block;padding:13px 22px;background:#5B2D8E;color:#fff;border-radius:100px;font-size:14px;font-weight:700;text-decoration:none">Открыть чат с нами в Telegram</a>
</td></tr>
<tr><td style="font-size:12px;color:#888;line-height:1.6;padding-bottom:4px">
Необязательно — запись уже подтверждена. В боте удобно перенести урок и напомнить себе ссылку.
</td></tr>`);
}

// --- адаптеры провайдеров ---
// Каждый получает одинаковый msg: { from:{name,email}, to, replyTo, subject, html, ics }

async function sendPostmark(msg) {
  const body = {
    From: msg.from.name ? `${msg.from.name} <${msg.from.email}>` : msg.from.email,
    To: msg.to,
    Subject: msg.subject,
    HtmlBody: msg.html,
    MessageStream: process.env.POSTMARK_STREAM || 'outbound'
  };
  if (msg.replyTo) body.ReplyTo = msg.replyTo;
  if (msg.ics) {
    body.Attachments = [{
      Name: 'say-yes-probny-urok.ics',
      Content: Buffer.from(msg.ics, 'utf-8').toString('base64'),
      ContentType: 'text/calendar; charset=utf-8; method=PUBLISH'
    }];
  }
  return fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN
    },
    body: JSON.stringify(body)
  });
}

async function sendZeptoMail(msg) {
  const body = {
    from: { address: msg.from.email, name: msg.from.name || undefined },
    to: [{ email_address: { address: msg.to } }],
    subject: msg.subject,
    htmlbody: msg.html
  };
  if (msg.replyTo) body.reply_to = [{ address: msg.replyTo }];
  if (msg.ics) {
    body.attachments = [{
      name: 'say-yes-probny-urok.ics',
      content: Buffer.from(msg.ics, 'utf-8').toString('base64'),
      mime_type: 'text/calendar'
    }];
  }
  // Домен и почта школы в европейском датацентре Zoho, поэтому по умолчанию .eu
  const url = process.env.ZEPTOMAIL_URL || 'https://api.zeptomail.eu/v1.1/email';
  return fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Zoho-enczapikey ${process.env.ZEPTOMAIL_TOKEN}`
    },
    body: JSON.stringify(body)
  });
}

async function sendSendGrid(msg) {
  const body = {
    personalizations: [{ to: [{ email: msg.to }] }],
    from: { email: msg.from.email, name: msg.from.name || undefined },
    subject: msg.subject,
    content: [{ type: 'text/html', value: msg.html }]
  };
  if (msg.replyTo) body.reply_to = { email: msg.replyTo };
  if (msg.ics) {
    body.attachments = [{
      content: Buffer.from(msg.ics, 'utf-8').toString('base64'),
      filename: 'say-yes-probny-urok.ics',
      type: 'text/calendar',
      disposition: 'attachment'
    }];
  }
  return fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`
    },
    body: JSON.stringify(body)
  });
}

async function sendResend(msg) {
  const body = {
    from: msg.from.name ? `${msg.from.name} <${msg.from.email}>` : msg.from.email,
    to: [msg.to],
    subject: msg.subject,
    html: msg.html
  };
  if (msg.replyTo) body.reply_to = msg.replyTo;
  if (msg.ics) {
    body.attachments = [{
      filename: 'say-yes-probny-urok.ics',
      content: Buffer.from(msg.ics, 'utf-8').toString('base64')
    }];
  }
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

const ADAPTERS = {
  postmark: sendPostmark,
  zeptomail: sendZeptoMail,
  sendgrid: sendSendGrid,
  resend: sendResend
};

// Отправка. Никогда не бросает наружу: запись важнее письма.
// Последняя ошибка почты хранится неделю: без неё молчаливый отказ провайдера
// обнаруживается только жалобой клиента «письмо не пришло».
async function storeMailError(info) {
  try {
    await kvSet('last_mail_error', JSON.stringify({ ...info, at: new Date().toISOString() }), 604800);
  } catch (e) {
    console.error('Cannot store mail error:', e);
  }
}

export async function sendBookingConfirmation(booking, mode = 'new') {
  const which = provider();
  if (!which) return { skipped: 'no mail provider configured' };
  if (!booking || !booking.email) return { skipped: 'no email' };

  const hasSlot = booking.slot && booking.slot !== 'no_time';
  const localForSubject = localSlot(booking);
  const when = localForSubject
    ? `${localForSubject.date} ${localForSubject.time}`
    : `${booking.slotDate || ''} ${booking.slotLocal || ''}`.trim();
  const subject = mode === 'reschedule'
    ? `Запись перенесена — ${when}`.trim()
    : (hasSlot
      ? `Вы записаны на пробный урок — ${when}`.trim()
      : 'Заявка принята — подберём время для пробного урока');

  const msg = {
    from: parseFrom(MAIL_FROM()),
    to: booking.email,
    replyTo: MAIL_REPLY_TO(),
    subject,
    html: confirmationHtml(booking, mode),
    ics: hasSlot ? buildIcs(booking.slot, booking.id) : null
  };

  try {
    const resp = await ADAPTERS[which](msg);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`Mail (${which}) error:`, resp.status, text.slice(0, 400));
      // Ошибка отправки раньше видна была только в логах Vercel, то есть практически
      // никому. Кладём последнюю в базу — её видно через /api/health/email.
      await storeMailError({ provider: which, status: resp.status, text: text.slice(0, 300) });
      return { ok: false, provider: which, status: resp.status };
    }
    return { ok: true, provider: which };
  } catch (e) {
    console.error(`Mail (${which}) request failed:`, e);
    await storeMailError({ provider: which, error: String(e).slice(0, 300) });
    return { ok: false, provider: which, error: String(e) };
  }
}

// Касание перед уроком: напоминание и анонс бонуса. Отдельным письмом, а не строкой
// в подтверждении — там его не замечали. Задача одна: довести человека до урока.
// Единственное выделение в письме — абзац с бонусом, так просил клиент.
function handoutSubject(booking) {
  const local = localSlot(booking);
  return local ? `Ждём вас на пробном уроке ${local.date}` : 'Что вас ждёт на пробном уроке';
}

function handoutHtml(booking) {
  const local = localSlot(booking);
  const when = local ? `${local.date}, ${local.time}` : `${booking.slotDate || ''} ${booking.slotLocal || ''}`.trim();
  const botLink = `${BOT_LINK_BASE}?start=${encodeURIComponent(booking.id || '')}`;
  return layout(`
<tr><td style="font-size:22px;font-weight:800;line-height:1.3;padding-bottom:14px">Ждём вас на уроке ${esc(when)}</td></tr>
<tr><td style="font-size:14px;line-height:1.7;color:#444;padding-bottom:10px">
Во время пробного занятия преподаватель:
</td></tr>
<tr><td style="font-size:14px;line-height:1.7;color:#444;padding-bottom:18px">
• определит ваш уровень и обозначит сильные стороны и области для развития<br>
• познакомит вас с полезными разговорными конструкциями, которые вы сможете сразу использовать в речи<br>
• составит план обучения под вашу цель: что подтянуть в первую очередь и в каком темпе двигаться
</td></tr>
<tr><td style="font-size:14px;line-height:1.7;color:#444;padding-bottom:18px">
Ссылка на урок: <a href="${ZOOM_JOIN_URL}" style="color:#5B2D8E;font-weight:700">подключиться в Zoom</a><br>
<span style="color:#6b4b8a">Идентификатор ${ZOOM_MEETING_ID}, код доступа ${ZOOM_PASSCODE}</span>
</td></tr>
<tr><td style="font-size:14px;line-height:1.7;color:#1a1a1a;font-weight:700;background:#f5f0fb;border-radius:12px;padding:14px 16px">
💡 Бонус: после урока — подборка ресурсов под ваши цели: что смотреть, слушать и читать именно на вашем уровне. Преподаватель соберёт её лично для вас.
</td></tr>
<tr><td style="height:18px"></td></tr>
<tr><td style="font-size:14px;line-height:1.7;color:#444;padding-bottom:18px">
Если ваши планы изменятся, пожалуйста, заранее сообщите менеджеру или <a href="${botLink}" style="color:#5B2D8E">перенесите урок самостоятельно</a>.
</td></tr>
<tr><td style="font-size:14px;line-height:1.7;color:#444">
See you soon! Школа английского языка Say Yes! 💜
</td></tr>`);
}

export async function sendHandoutEmail(booking) {
  const which = provider();
  if (!which) return { skipped: 'no mail provider configured' };
  if (!booking || !booking.email) return { skipped: 'no email' };

  const msg = {
    from: parseFrom(MAIL_FROM()),
    to: booking.email,
    replyTo: MAIL_REPLY_TO(),
    subject: handoutSubject(booking),
    html: handoutHtml(booking),
    ics: null
  };

  try {
    const resp = await ADAPTERS[which](msg);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`Mail handout (${which}) error:`, resp.status, text.slice(0, 400));
      return { ok: false, provider: which, status: resp.status };
    }
    return { ok: true, provider: which };
  } catch (e) {
    console.error(`Mail handout (${which}) request failed:`, e);
    return { ok: false, provider: which, error: String(e) };
  }
}

// Письмо о переносе — то же подтверждение, другой заголовок и тема.
export async function sendRescheduleConfirmation(booking) {
  return sendBookingConfirmation(booking, 'reschedule');
}
