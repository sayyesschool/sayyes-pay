import { kvGet, kvSet, getBooking, updateBooking } from '@/lib/redis';
import { sendMessage, editMessage } from '@/lib/telegram';
import { localSlot, tzHuman, clientHour, isClientNight } from '@/lib/time';

// Кому написать перед пробным уроком (11.11.2026, макеты согласованы Димой).
//
// Из неподтвердивших приходит около четверти, живое сообщение помогает. Поэтому
// неподтверждённые записи бот присылает в группу «вопросы клиентов» в трёх точках:
//   - 20:00 МСК: список на завтра;
//   - 10:00 МСК: записавшиеся после вечернего списка, урок сегодня;
//   - за 4 часа до урока по одному: записался сегодня и не подтвердил.
// Менеджер берёт человека кнопкой (в списке видно, кто пишет) и пишет ему через бота.
// Автоснятие теперь только после такого сообщения: ученик молчит 2 дневных часа
// (см. крон напоминаний). Нет сообщения менеджера - запись не снимается.
//
// Список в группе обновляется: кто пишет, подтвердил, перенёс, снята.

const SITE = 'https://www.sayyestoenglish.com';
const KEY = key => 'clist:' + key;
const INDEX = 'clist:index';
const TTL = 60 * 60 * 24 * 3;

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const firstName = b => esc(String((b && b.name) || 'Ученик').trim().split(/\s+/)[0]).slice(0, 20);
const slotMsk = slot => String(slot || '').split('_')[1] || '';

export function dayLabel(dateKey) {
  const [, m, d] = String(dateKey).split('-').map(Number);

  return d + ' ' + (MONTHS[m - 1] || '');
}

// Кандидат в список: урок впереди, не подтверждён, не снят, есть как связаться.
export function isContactCandidate(b) {
  return Boolean(b && b.slot && b.slot !== 'no_time'
    && !b.confirmed
    && b.status !== 'cancelled'
    && !b.releasedUnconfirmed
    && !b.archived && !b.introTest
    && (b.attended === undefined || b.attended === null)
    && (b.chatId || b.email)
    && !b.contactListAt);
}

// Строка ученика без статуса: фиксируется в момент отправки.
function baseLine(b, now) {
  const local = localSlot(b);
  const zone = local && !local.assumed ? tzHuman(b) : '';
  const theirs = local
    ? (local.assumed ? 'пояс неизвестен' : 'у ученика ' + local.time + (zone ? ', ' + esc(zone.split(',')[0]) : ''))
    : 'пояс неизвестен';
  let line = firstName(b) + ', ' + slotMsk(b.slot) + ' МСК (' + theirs + '), ' + (b.chatId ? 'бот' : 'только почта');

  if (local && !local.assumed && isClientNight(b, now)) {
    const h = String(clientHour(b, now)).padStart(2, '0');
    const mm = String(new Date(now).getUTCMinutes()).padStart(2, '0');

    line += ' - у ученика сейчас ' + h + ':' + mm + ', лучше утром';
  }

  return line;
}

function statusOf(item, b) {
  if (!b) return { text: ' - запись не найдена', done: true };
  if (b.status === 'cancelled' && b.releasedUnconfirmed) return { text: ' - 🕕 снята', done: true };
  if (b.status === 'cancelled') return { text: ' - ❌ отменена', done: true };
  if (b.slot !== item.slot) {
    return { text: ' - 📅 перенесено на ' + esc(b.slotDate || dayLabel(String(b.slot).split('_')[0])) + ' ' + slotMsk(b.slot) + ' МСК', done: true };
  }
  if (b.confirmed) return { text: ' - ✅ подтверждено', done: true };
  if (b.contactClaimBy) return { text: ' - пишет ' + esc(b.contactClaimBy), done: false };

  return { text: '', done: false };
}

function render(list, byId) {
  const lines = [];
  const rows = [];

  list.items.forEach((item, i) => {
    const b = byId.get(item.id);
    const st = statusOf(item, b);
    const prefix = list.kind === 'ping' ? '' : (i + 1) + '. ';

    lines.push(prefix + item.base + st.text);

    if (!st.done && b) {
      const label = firstName(b) + ' ' + slotMsk(item.slot);

      rows.push(b.chatId
        ? [{ text: '✍️ ' + label, callback_data: 'mgr_write:' + b.id }]
        : [{ text: '✉️ ' + label + ': карточка', url: SITE + '/admin/client/' + b.id }]);
    }
  });

  const text = list.kind === 'ping'
    ? list.title + '\n' + lines.join('\n') + '\n\n' + list.intro
    : list.title + '\n\n' + list.intro + '\n\n' + lines.join('\n');

  return { text, keyboard: { inline_keyboard: rows } };
}

const INTRO_LIST = 'Напишите каждому коротко от себя. Нажмите кнопку с именем, бот откроет личку.\n'
  + 'Не ответит 2 часа (днём по его времени) - запись снимется, место уйдёт другим.';

// kind: 'evening' | 'morning' | 'ping'. bookings уже отобраны и отсортированы.
export async function postContactList(kind, dateKey, bookings, now = new Date()) {
  const chatId = await kvGet('clients_chat_id');

  if (!chatId || !bookings.length) return null;

  let title;
  let intro = INTRO_LIST;

  if (kind === 'evening') {
    title = '📋 <b>Не подтвердили урок на завтра, ' + dayLabel(dateKey) + '</b>';
  } else if (kind === 'morning') {
    title = '📋 <b>Записались вечером и не подтвердили урок сегодня, ' + dayLabel(dateKey) + '</b>';
  } else {
    const b = bookings[0];
    const started = b.rescheduledAt || b.createdAt;
    const mskIso = started ? new Date(new Date(started).getTime() + 3 * 3600 * 1000).toISOString() : '';
    const today = mskIso && mskIso.slice(0, 10) === dateKey;

    title = '⏳ <b>Урок сегодня не подтверждён</b>' + (today ? ' (запись сделана сегодня в ' + mskIso.slice(11, 16) + ' МСК)' : '');
    intro = 'Напишите коротко от себя: нажмите кнопку, бот откроет личку.\n'
      + 'Не ответит 2 часа (днём по его времени) - запись снимется.';
  }

  const key = kind === 'ping' ? 'ping:' + bookings[0].id : kind + ':' + dateKey;
  const list = {
    key, kind, chatId: String(chatId), title, intro,
    items: bookings.map(b => ({ id: b.id, slot: b.slot, base: baseLine(b, now) })),
    sentAt: now.toISOString()
  };
  const view = render(list, new Map(bookings.map(b => [b.id, b])));
  const res = await sendMessage(chatId, view.text, { reply_markup: view.keyboard });

  if (!res || !res.ok) {
    console.error('Contact list send failed:', key, res && res.description);
    return null;
  }

  list.messageId = res.result.message_id;
  list.lastView = JSON.stringify(view);
  await kvSet(KEY(key), list, TTL);

  const index = ((await kvGet(INDEX)) || []).filter(e => e && Date.now() - new Date(e.at).getTime() < 36 * 3600 * 1000);

  index.push({ key, at: now.toISOString() });
  await kvSet(INDEX, index, TTL);

  for (const b of bookings) {
    b.contactListAt = now.toISOString();
    b.contactList = key;
    await updateBooking(b.id, { contactListAt: b.contactListAt, contactList: key });
  }

  return key;
}

export async function refreshContactList(key, known = new Map()) {
  const list = await kvGet(KEY(key));

  if (!list || !list.messageId) return false;

  const byId = new Map();

  for (const item of list.items) {
    byId.set(item.id, known.get(item.id) || await getBooking(item.id));
  }

  const view = render(list, byId);
  const packed = JSON.stringify(view);

  if (packed === list.lastView) return false;

  const res = await editMessage(list.chatId, list.messageId, view.text, { reply_markup: view.keyboard });

  if (res && (res.ok || /not modified/i.test(String(res.description || '')))) {
    list.lastView = packed;
    await kvSet(KEY(key), list, TTL);
  }

  return true;
}

// Все списки за последние 36 часов. Крон зовёт раз в ~15 минут.
export async function refreshContactLists(known = new Map()) {
  const index = (await kvGet(INDEX)) || [];
  let edited = 0;

  for (const e of index) {
    if (!e || Date.now() - new Date(e.at).getTime() > 36 * 3600 * 1000) continue;

    try {
      if (await refreshContactList(e.key, known)) edited++;
    } catch (err) {
      console.error('Contact list refresh error:', e.key, err);
    }
  }

  return edited;
}

// Менеджер нажал кнопку с именем: отмечаем, кто пишет, и сразу обновляем список.
export async function claimContact(booking, username) {
  if (!booking || !booking.contactList) return false;

  const by = '@' + String(username || '').replace(/^@/, '');

  if (booking.contactClaimBy !== by) {
    await updateBooking(booking.id, { contactClaimBy: by, contactClaimAt: new Date().toISOString() });
  }

  try {
    await refreshContactList(booking.contactList);
  } catch (e) {
    console.error('Contact claim refresh error:', booking.id, e);
  }

  return true;
}
