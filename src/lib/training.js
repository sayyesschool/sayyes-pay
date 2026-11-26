import { getBooking, updateBooking, kvGet, kvSet } from '@/lib/redis';
import { addMessage } from '@/lib/thread';
import { stopOffer, OFFER_REASONS } from '@/lib/offerChain';
import { sendMessage } from '@/lib/telegram';
import { notifyManagers } from '@/lib/managers';

// Статус обучения в карточке клиента (26.11.2026, макет согласован Димой):
// «Отказ» после оффера (причина как в вопросе «что помешало») и «Закончил обучение».
// У обоих необязательная дата «когда вернуться»: в этот день в 10:00 МСК в группу
// менеджеров приходит напоминание, а клиент висит в «Вернуться сегодня», пока дату
// не сменят или статус не снимут. Ученику ничего не уходит.
// booking.training = { kind, at, by, reason, comment, returnAt, returnRemindedFor }
export const TRAINING_KINDS = { refused: '🚫 Отказ', finished: '🎓 Закончил обучение' };
export const REFUSE_REASONS = OFFER_REASONS;

const RETURN_INDEX = 'training:return';

function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function ruDate(key) {
  if (!key) return '';
  const [y, m, d] = String(key).split('-');

  return d + '.' + m + '.' + y;
}

export function trainingLine(t) {
  if (!t || !TRAINING_KINDS[t.kind]) return '';

  const at = t.at ? ruDate(new Date(new Date(t.at).getTime() + 3 * 3600000).toISOString().slice(0, 10)) : '';

  return [TRAINING_KINDS[t.kind], at, t.by,
    t.kind === 'refused' && t.reason ? REFUSE_REASONS[t.reason] : '',
    t.returnAt ? 'вернуться ' + ruDate(t.returnAt) : ''].filter(Boolean).join(' · ');
}

async function setIndex(bookingId, date) {
  const map = (await kvGet(RETURN_INDEX)) || {};

  if (date) map[bookingId] = date; else delete map[bookingId];
  await kvSet(RETURN_INDEX, map);
}

export async function setTraining(bookingId, { kind, reason, comment, returnAt }, by) {
  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена' };
  if (!TRAINING_KINDS[kind]) return { ok: false, error: 'Неизвестный статус' };
  if (kind === 'refused' && !REFUSE_REASONS[reason]) return { ok: false, error: 'Выберите причину отказа' };
  if (kind === 'finished' && !booking.paid) return { ok: false, error: '«Закончил обучение» ставится только тем, кто хоть раз платил' };
  if (returnAt && !validDate(returnAt)) return { ok: false, error: 'Дата указана неверно' };

  const training = {
    kind,
    at: new Date().toISOString(),
    by: '@' + by,
    reason: kind === 'refused' ? Number(reason) : null,
    comment: String(comment || '').trim().slice(0, 500) || null,
    returnAt: returnAt || null,
    returnRemindedFor: null
  };

  await updateBooking(bookingId, { training });
  await setIndex(bookingId, training.returnAt);

  let stopped = '';

  if (kind === 'refused' && booking.offer && !booking.offer.stopped) {
    const r = await stopOffer(bookingId, by, 'refused');

    if (r.ok) stopped = ', цепочка оффера остановлена';
  }

  await addMessage(bookingId, {
    from: 'system', by: '@' + by,
    text: 'Статус: ' + trainingLine(training) + (training.comment ? '\n' + training.comment : '')
  });

  return { ok: true, message: 'Статус сохранён: ' + TRAINING_KINDS[kind] + stopped };
}

export async function clearTraining(bookingId, by) {
  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена' };
  if (!booking.training) return { ok: true, message: 'Статуса нет' };

  await updateBooking(bookingId, { training: null });
  await setIndex(bookingId, null);
  await addMessage(bookingId, { from: 'system', by: '@' + by, text: 'Статус снят: ' + trainingLine(booking.training) });

  return { ok: true, message: 'Статус снят' };
}

// Крон, с 10:00 МСК: одно напоминание на дату на клиента.
export async function remindReturns(mskToday) {
  const map = (await kvGet(RETURN_INDEX)) || {};
  const chatId = await kvGet('clients_chat_id');
  let sent = 0;
  let changed = false;

  for (const [id, date] of Object.entries(map)) {
    if (date > mskToday) continue;

    const booking = await getBooking(id);
    const t = booking && booking.training;

    if (!t || t.returnAt !== date) { delete map[id]; changed = true; continue; }
    if (t.returnRemindedFor === date) continue;

    const text = '📅 <b>Вернуться к клиенту:</b> ' + (booking.name || id) + '\n'
      + trainingLine(t) + (t.comment ? '\n' + t.comment : '') + '\n'
      + 'Статус ставил(а) ' + t.by + '\n'
      + 'Карточка: https://www.sayyestoenglish.com/admin/client/' + id;

    const res = chatId ? await sendMessage(chatId, text) : null;

    if (!res || !res.ok) await notifyManagers(text);
    await updateBooking(id, { training: { ...t, returnRemindedFor: date } });
    sent++;
  }

  if (changed) await kvSet(RETURN_INDEX, map);

  return sent;
}
