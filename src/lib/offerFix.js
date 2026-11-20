import { loadBookings } from '@/lib/analytics';
import { updateBooking, kvSet } from '@/lib/redis';
import { sendMessage } from '@/lib/telegram';
import { sendManagerReplyEmail } from '@/lib/email';
import { addMessage } from '@/lib/thread';
import { resolveTz } from '@/lib/time';

// Извинение за неверную ссылку оффера (20.11.2026, решение Димы): с 06.11 по 20.11 ссылка
// в сообщениях цепочки вела на главную без пакета за 30 €. Пишем всем, кто не оплатил,
// от имени менеджера, запустившего оффер. Истёкшим - новый срок 72 часа от сообщения.
export const FIX_FROM = '2026-11-06';
export const FIX_AT = '2026-11-20T15:00:00Z';
const SITE = 'https://www.sayyestoenglish.com/';
const H = 3600 * 1000;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function localWhen(booking, ms) {
  const { tz } = resolveTz(booking);
  const p = {};

  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms))) p[x.type] = x.value;

  return Number(p.day) + ' ' + MONTHS[Number(p.month) - 1] + ', ' + p.hour + ':' + p.minute + ' по вашему времени';
}

export async function affectedBookings() {
  return (await loadBookings()).filter(b => b.offer && String(b.offer.startedAt || '') >= FIX_FROM
    && b.offer.sent && Object.keys(b.offer.sent).some(k => /^[1-4]$/.test(k) && String(b.offer.sent[k]) < FIX_AT));
}

export function fixPlan(b, nowMs = Date.now()) {
  const name = String(b.name || '').trim().split(' ')[0];
  const hi = name && !name.includes('@') ? name + ', здравствуйте!' : 'Здравствуйте!';
  const who = (b.offer.manager && b.offer.manager.name) || 'команда';
  const deadline = b.offer.deadline ? new Date(b.offer.deadline).getTime() : 0;
  const expired = !deadline || deadline <= nowMs + 2 * H;
  const newDeadline = expired ? nowMs + 72 * H : deadline;
  const link = SITE + '?b=' + encodeURIComponent(b.id);
  const text = hi + ' Это ' + who + ' из Say Yes!.\n\n'
    + (expired
      ? 'Извините, ссылка в наших сообщениях после пробного урока открывала не ту страницу, и оплатить пакет «2 урока за 30 €» было нельзя. Это наша ошибка, поэтому мы снова открыли предложение для вас.'
      : 'Извините, ссылка в прошлом сообщении открывала не ту страницу, и пакета «2 урока за 30 €» там не было. Сейчас всё исправлено.')
    + '\n\nОплатить можно здесь: ' + link
    + '\nПредложение действует до ' + localWhen(b, newDeadline) + '.'
    + '\n\nЕсли остались вопросы по формату или расписанию, просто ответьте на это сообщение.';

  return { expired, newDeadline, text, channel: b.chatId ? 'bot' : b.email ? 'email' : null };
}

export async function sendOfferFix(by) {
  const list = (await affectedBookings()).filter(b => !(b.introPaid || b.paid) && !b.offerFixSentAt);
  let sent = 0;
  const failed = [];

  for (const b of list) {
    const plan = fixPlan(b);
    let ok = false;

    try {
      if (plan.channel === 'bot') {
        const r = await sendMessage(b.chatId, plan.text);

        ok = Boolean(r && r.ok);
      } else if (plan.channel === 'email') {
        const r = await sendManagerReplyEmail(b, { text: plan.text, managerName: b.offer.manager && b.offer.manager.name, subject: 'Say Yes!: правильная ссылка на 2 урока за 30 €' });

        ok = Boolean(r && r.ok);
      }
    } catch (e) {
      console.error('Offer fix send error:', b.id, e);
    }

    if (!ok) { failed.push(b.name || b.id); continue; }

    await updateBooking(b.id, {
      offerFixSentAt: new Date().toISOString(),
      introExpiresAt: new Date(plan.newDeadline).toISOString(),
      introNoExpiry: false,
      offer: { ...b.offer, deadline: new Date(plan.newDeadline).toISOString() }
    });
    if (b.chatId) await kvSet('relay:' + b.chatId, b.id);
    await addMessage(b.id, { from: 'manager', by: '@' + by, channel: plan.channel === 'email' ? 'email' : undefined, text: plan.text });
    sent++;
  }

  return { ok: true, message: 'Отправлено: ' + sent + (failed.length ? '. Не ушло: ' + failed.join(', ') : '') };
}

// Тем, кому извинение уже ушло до появления relay: ответ ученика должен дойти до группы.
export async function ensureRelayForSent(list) {
  for (const b of list) if (b.offerFixSentAt && b.chatId) await kvSet('relay:' + b.chatId, b.id);
}
