// Письмо с подтверждением записи.
//
// Раньше подтверждение существовало только двумя способами: экран после записи и
// сообщение в Telegram — а Telegram доходил лишь до тех, кто нажал «Начать» в боте.
// Почта закрывает этот разрыв: письмо уходит сразу и не зависит ни от чего.
//
// Всё под флагом: без RESEND_API_KEY модуль молча ничего не делает, ошибка отправки
// никогда не роняет саму запись.

const RESEND_API_KEY = () => process.env.RESEND_API_KEY;
const MAIL_FROM = () => process.env.MAIL_FROM || 'SAY YES <hello@sayyestoenglish.com>';
const MAIL_REPLY_TO = () => process.env.MAIL_REPLY_TO || '';
const BOT_LINK_BASE = 'https://t.me/SY_school_bot';

export function emailEnabled() {
  return !!RESEND_API_KEY();
}

// --- .ics ---
// Ключ слота — «2026-08-28_19:00» по Москве. МСК = UTC+3, поэтому в UTC минус 3 часа.
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
    'PRODID:-//SAY YES English School//learn_easy//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + (bookingId || 'sayyes') + '@sayyestoenglish.com',
    'DTSTAMP:' + stamp(new Date()),
    'DTSTART:' + stamp(startUtc),
    'DTEND:' + stamp(endUtc),
    'SUMMARY:Пробный урок английского — SAY YES',
    'DESCRIPTION:Пробный урок 30 минут в Zoom. Ссылку пришлём за час до начала.',
    'LOCATION:Zoom',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Пробный урок английского через час',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
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
SAY YES English School · <a href="https://sayyes.school" style="color:#5B2D8E">sayyes.school</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

function confirmationHtml(booking, mode) {
  const hasSlot = booking.slot && booking.slot !== 'no_time';
  const name = booking.name ? String(booking.name).split(' ')[0] : '';
  const greeting = name ? `, ${esc(name)}` : '';
  const clientTime = booking.slotLocal || booking.slotMsk || '';
  const timeLabel = booking.slotLocal ? 'Время' : 'Время (МСК)';
  const botLink = `${BOT_LINK_BASE}?start=${encodeURIComponent(booking.id || '')}`;

  const when = hasSlot
    ? `<tr><td style="padding-bottom:18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EDFA;border-radius:14px;padding:16px">
<tr><td style="font-size:13px;color:#3D1B5E;line-height:1.9">
<b>Дата:</b> ${esc(booking.slotDate || '—')}<br>
<b>${timeLabel}:</b> ${esc(clientTime || '—')}<br>
<b>Формат:</b> пробный урок · 30 минут · Zoom
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
✔ Ссылку на Zoom пришлём за час до начала<br>
✔ Перенести или отменить можно в любой момент<br>
✔ На уроке разберём вашу реальную ситуацию — аптека, врач, школа ребёнка или работа
</td></tr>
${hasSlot ? `<tr><td style="padding-bottom:18px;font-size:13px;color:#666;line-height:1.6">
Файл во вложении добавляет урок в календарь с напоминанием за час.</td></tr>` : ''}
<tr><td style="padding-bottom:6px">
<a href="${botLink}" style="display:inline-block;padding:13px 22px;background:#5B2D8E;color:#fff;border-radius:100px;font-size:14px;font-weight:700;text-decoration:none">Открыть чат с нами в Telegram</a>
</td></tr>
<tr><td style="font-size:12px;color:#888;line-height:1.6;padding-bottom:4px">
Необязательно — запись уже подтверждена. В боте удобно перенести урок и получить ссылку на Zoom.
</td></tr>`);
}

// Отправка. Никогда не бросает наружу: запись важнее письма.
export async function sendBookingConfirmation(booking, mode = 'new') {
  const key = RESEND_API_KEY();
  if (!key) return { skipped: 'no RESEND_API_KEY' };
  if (!booking || !booking.email) return { skipped: 'no email' };

  const hasSlot = booking.slot && booking.slot !== 'no_time';
  const when = `${booking.slotDate || ''} ${booking.slotLocal || booking.slotMsk || ''}`.trim();
  const subject = mode === 'reschedule'
    ? `Запись перенесена — ${when}`.trim()
    : (hasSlot
      ? `Вы записаны на пробный урок — ${when}`.trim()
      : 'Заявка принята — подберём время для пробного урока');

  const body = {
    from: MAIL_FROM(),
    to: [booking.email],
    subject,
    html: confirmationHtml(booking, mode)
  };
  if (MAIL_REPLY_TO()) body.reply_to = MAIL_REPLY_TO();

  const ics = hasSlot ? buildIcs(booking.slot, booking.id) : null;
  if (ics) {
    body.attachments = [{
      filename: 'say-yes-probny-urok.ics',
      content: Buffer.from(ics, 'utf-8').toString('base64')
    }];
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('Resend error:', resp.status, data);
      return { ok: false, status: resp.status, data };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    console.error('Resend request failed:', e);
    return { ok: false, error: String(e) };
  }
}

// Письмо о переносе — то же подтверждение, другой заголовок и тема.
export async function sendRescheduleConfirmation(booking) {
  return sendBookingConfirmation(booking, 'reschedule');
}
