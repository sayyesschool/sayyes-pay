import { getBooking, updateBooking, kvGet } from '@/lib/redis';
import { sendMessage } from '@/lib/telegram';
import { resolveTz } from '@/lib/time';
import { sendOfferChainEmail } from '@/lib/email';
import { getProfiles } from '@/lib/access';
import { addMessage } from '@/lib/thread';

// Цепочка после пробного урока: оффер «2 урока за 30 €» (06.11.2026, документ
// «Цепочка после пробного урока итоговая.docx», согласован Димой).
//
// Запуск: менеджер жмёт «🎁 Запустить оффер» и выбирает своё имя. Дедлайн - 72 часа
// от конца урока. Четыре сообщения: 1 сразу (в окне 10:00-20:00 по времени клиента),
// 2 за сутки до 3, 3 накануне вечером или в день дедлайна, 4 утром после конца.
// Стоп: оплата, ответ клиента в боте, кнопка «Остановить цепочку».
// Повторно цепочка не запускается никогда.

const SITE = 'https://www.sayyestoenglish.com/';
const H = 3600 * 1000;
const WIN_FROM = 10;
const WIN_TO = 20;

export const OFFER_REASONS = {
  1: 'Не совсем подошёл формат обучения',
  2: 'Сейчас не самое подходящее время, возможно вернусь позже',
  3: 'Стоимость выше моего бюджета',
  4: 'Есть другая причина'
};

// --- Время в поясе клиента ---

const FMT = new Map();

function parts(ms, tz) {
  let f = FMT.get(tz);

  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    FMT.set(tz, f);
  }

  const o = {};

  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;

  return { y: +o.year, m: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute };
}

// Местные дата и время клиента -> момент UTC.
function zoned(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ms = guess;

  for (let i = 0; i < 2; i++) {
    const p = parts(ms, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);

    ms += guess - asUtc;
  }

  return ms;
}

function dayShift(p, k) {
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + k));

  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function inWindow(ms, tz) {
  const h = parts(ms, tz).h;

  return h >= WIN_FROM && h < WIN_TO;
}

function nextWindow(ms, tz) {
  if (inWindow(ms, tz)) return ms;

  const p = parts(ms, tz);
  const day = p.h >= WIN_TO ? dayShift(p, 1) : p;

  return zoned(day.y, day.m, day.d, WIN_FROM, 0, tz);
}

function tzOf(booking) {
  return resolveTz(booking).tz;
}

// Конец урока = начало слота (МСК) + 30 минут. Дедлайн = конец + 72 часа.
export function lessonEndMs(booking) {
  if (!booking || !booking.slot || booking.slot === 'no_time') return null;

  const [d, t] = String(booking.slot).split('_');
  const [y, mo, dd] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);

  if ([y, mo, dd, hh, mm].some(Number.isNaN)) return null;

  return Date.UTC(y, mo - 1, dd, hh - 3, mm) + 30 * 60 * 1000;
}

export function offerDeadlineMs(booking) {
  const end = lessonEndMs(booking);

  return end ? end + 72 * H : null;
}

// План отправки по таблице «Расписание».
export function planOffer(booking, launchMs) {
  const tz = tzOf(booking);
  const D = offerDeadlineMs(booking);

  if (!D) return null;

  const m1 = nextWindow(launchMs, tz);
  const dl = parts(D, tz);
  let m3;
  let variant3;

  if (dl.h < 14) {
    const prev = dayShift(dl, -1);

    m3 = zoned(prev.y, prev.m, prev.d, 19, 0, tz);
    variant3 = 'B';
  } else {
    m3 = Math.min(D - 4 * H, zoned(dl.y, dl.m, dl.d, WIN_TO, 0, tz));
    if (parts(m3, tz).h < WIN_FROM) m3 = zoned(dl.y, dl.m, dl.d, WIN_FROM, 0, tz);
    variant3 = 'A';
  }

  let m2 = m3 - 24 * H;
  let m4 = zoned(dl.y, dl.m, dl.d, WIN_FROM, 0, tz);

  if (m4 <= D) {
    const next = dayShift(dl, 1);

    m4 = zoned(next.y, next.m, next.d, WIN_FROM, 0, tz);
  }

  const skip2 = m2 <= m1 || m2 - m1 < 12 * H;
  const skip3 = m3 <= m1;

  return {
    tz, deadline: D, variant3,
    at: { 1: m1, 2: skip2 ? null : m2, 3: skip3 ? null : m3, 4: m4 }
  };
}

// --- Тексты ---

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function hhmm(p) {
  return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0');
}

function firstName(booking) {
  const n = String(booking.name || '').trim().split(' ')[0];

  return n && !n.includes('@') ? n : '';
}

function offerLink(booking) {
  return SITE + '?b=' + encodeURIComponent(booking.id);
}

// «завтра», «послезавтра», «сегодня вечером» - по времени клиента в момент отправки.
function whenWord(nowMs, D, tz) {
  const a = parts(nowMs, tz);
  const b = parts(D, tz);
  const diff = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / (24 * H));

  if (diff <= 0) return b.h >= 17 ? 'сегодня вечером' : 'сегодня';
  if (diff === 1) return 'завтра';

  return 'послезавтра';
}

function texts(booking, step, nowMs, manager) {
  const tz = tzOf(booking);
  const D = offerDeadlineMs(booking);
  const dp = parts(D, tz);
  const time = hhmm(dp) + ' по вашему времени';
  const dateTime = dp.d + ' ' + MONTHS[dp.m - 1] + ', ' + time;
  const name = firstName(booking);
  const hi = name ? name + ', здравствуйте!' : 'Здравствуйте!';
  const N = name ? name + ', ' : '';
  const Ncap = s => (name ? s : s.charAt(0).toUpperCase() + s.slice(1));
  const link = offerLink(booking);
  const who = manager.name;

  if (step === 1) {
    return {
      subject: (name ? name + ', п' : 'П') + 'редложение после пробного урока: 2 урока за 30 €',
      bot: `${hi} Это ${who} из Say Yes!. Спасибо, что пришли на пробный урок, надеюсь, он вам понравился 🙂\n\n` +
        `Для вас открыто специальное предложение: 2 урока за 30 € (индивидуально или в группе). Оно действует до ${dateTime}.\n\n` +
        `Забронировать можно здесь: ${link}`,
      mail: [`${hi} Это ${who} из Say Yes!. Спасибо, что пришли на пробный урок, надеюсь, он вам понравился.`,
        `Для вас открыто специальное предложение: 2 урока за 30 € (индивидуально или в группе). Оно действует до ${dateTime}.`]
    };
  }

  if (step === 2) {
    const when = whenWord(nowMs, D, tz);
    const left = when === 'послезавтра' ? 'осталось 2 дня' : 'остался 1 день';

    return {
      subject: left.charAt(0).toUpperCase() + left.slice(1) + ': 2 урока за 30 €',
      bot: `${N}${Ncap(left)}: ${when} в ${time} предложение «2 урока за 30 €» закончится.\n\n` +
        'Если есть вопросы по формату, расписанию или оплате, ответьте на это сообщение, я подскажу.\n\n' + link,
      mail: [`${N}${Ncap(left)}: ${when} в ${time} предложение «2 урока за 30 €» закончится.`,
        'Если есть вопросы по формату, расписанию или оплате, ответьте на это письмо, я подскажу.']
    };
  }

  if (step === 3) {
    const sameDay = whenWord(nowMs, D, tz).startsWith('сегодня');

    if (sameDay) {
      return {
        subject: 'Сегодня последний день: 2 урока за 30 €',
        bot: `${N}${Ncap('сегодня последний день предложения: 2 урока за 30 €.')} Бронируйте до ${time}, потом оно закончится.\n\n${link}`,
        mail: [`${N}${Ncap('сегодня последний день предложения: 2 урока за 30 €.')} Бронируйте до ${time}, потом оно закончится.`]
      };
    }

    return {
      subject: 'Завтра закончится предложение: 2 урока за 30 €',
      bot: `${N}${Ncap('завтра')} в ${time} предложение «2 урока за 30 €» закончится. Если хотите им воспользоваться, бронируйте до этого времени.\n\n${link}`,
      mail: [`${N}${Ncap('завтра')} в ${time} предложение «2 урока за 30 €» закончится. Если хотите им воспользоваться, бронируйте до этого времени.`]
    };
  }

  return {
    subject: (name ? name + ', о' : 'О') + 'дин вопрос: что помешало?',
    bot: `${N}${Ncap('предложение закончилось, но я на связи 🙂')}\n\nПодскажите, пожалуйста, что помешало?\n\nМне будет важно узнать, поделитесь, пожалуйста ❤️`,
    mail: [`${N}${Ncap('предложение закончилось, но я на связи 🙂')}`,
      'Подскажите, пожалуйста, что помешало? Ответьте на это письмо цифрой или своими словами:',
      Object.entries(OFFER_REASONS).map(([k, v]) => k + '. ' + v).join('<br>'),
      'Мне будет важно узнать, поделитесь, пожалуйста ❤️'],
    noButton: true
  };
}

function reasonKeyboard(bookingId) {
  return {
    reply_markup: {
      inline_keyboard: Object.entries(OFFER_REASONS).map(([k, v]) => [{ text: v, callback_data: `offr:${bookingId}:${k}` }])
    }
  };
}

// --- Отправка одного сообщения ---

async function sendStep(booking, step, nowMs) {
  const offer = booking.offer;
  const t = texts(booking, step, nowMs, offer.manager);
  let channel = '';

  if (booking.chatId) {
    const res = await sendMessage(booking.chatId, t.bot, step === 4 ? reasonKeyboard(booking.id) : {});

    if (res && res.ok) channel = 'bot';
  }

  if (!channel && booking.email) {
    const mail = await sendOfferChainEmail(booking, {
      subject: t.subject,
      paragraphs: t.mail,
      link: t.noButton ? null : offerLink(booking),
      managerName: offer.manager.name
    });

    if (mail && mail.ok) {
      channel = 'mail';
      // Письмо видно в переписке карточки; тема и Message-ID нужны, чтобы ответ
      // менеджера из карточки продолжил ту же цепочку писем (10.11.2026).
      const plain = (t.mail || []).map(p => String(p).replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')).join('\n\n');

      await addMessage(booking.id, {
        from: 'manager', by: offer.manager.name, channel: 'email', subject: t.subject,
        text: plain + (t.noButton ? '' : '\n\n[Забронировать: ' + offerLink(booking) + ']')
      });
      await updateBooking(booking.id, { mailLastSubject: t.subject, mailLastOutId: mail.messageId, mailThread: true });
    }
  }

  return channel;
}

// --- Запуск ---

export async function launchOffer(bookingId, managerUsername, by) {
  const booking = await getBooking(bookingId);

  if (!booking) return { ok: false, error: 'Запись не найдена' };
  if (booking.attended !== true) return { ok: false, error: 'Сначала отметьте «Пришёл»' };
  if (booking.introPaid) return { ok: false, error: 'Спецпредложение уже оплачено' };
  if (booking.offer) return { ok: false, error: 'Цепочка по этой заявке уже запускалась, повторно не запускается' };
  if (!booking.chatId && !booking.email) return { ok: false, error: 'Некуда писать: нет ни бота, ни почты' };

  const profiles = await getProfiles();
  const profile = profiles.find(p => p.username === String(managerUsername || '').toLowerCase());

  if (!profile || !profile.name) return { ok: false, error: 'У этого сотрудника не заполнено «Имя для клиентов» в «Доступах»' };

  const now = Date.now();
  const deadline = offerDeadlineMs(booking);

  if (!deadline || deadline <= now) return { ok: false, error: 'Срок оффера уже прошёл. Ссылку можно отправить вручную' };

  const plan = planOffer(booking, now);

  if (!plan || plan.at[1] >= deadline) {
    return { ok: false, error: 'До конца оффера не осталось дневного времени клиента. Ссылку можно отправить вручную' };
  }

  const offer = {
    startedAt: new Date(now).toISOString(),
    startedBy: '@' + by,
    manager: { username: profile.username, name: profile.name, email: profile.email || '' },
    deadline: new Date(deadline).toISOString(),
    plan: Object.fromEntries(Object.entries(plan.at).map(([k, v]) => [k, v ? new Date(v).toISOString() : null])),
    sent: {},
    paused: false,
    stopped: false
  };

  await updateBooking(booking.id, {
    offer,
    introExpiresAt: new Date(deadline).toISOString(),
    introNoExpiry: false
  });

  let result = '';

  if (plan.at[1] <= now + 60 * 1000) {
    const fresh = { ...booking, offer, introExpiresAt: new Date(deadline).toISOString() };
    const channel = await sendStep(fresh, 1, now);

    if (channel) {
      offer.sent[1] = new Date().toISOString();
      await updateBooking(booking.id, {
        offer,
        introSentAt: new Date().toISOString(),
        payLinkSentAt: booking.payLinkSentAt || new Date().toISOString()
      });
      await addMessage(booking.id, { from: 'manager', text: '🎁 Оффер: сообщение 1 отправлено (' + (channel === 'bot' ? 'бот' : 'почта') + ')', by: '@' + by });
      result = 'сообщение 1 ушло сейчас';
    } else {
      result = 'сообщение 1 не ушло, крон попробует снова';
    }
  } else {
    result = 'сообщение 1 уйдёт ' + mskText(plan.at[1]) + ' МСК (у клиента ночь)';
  }

  return { ok: true, message: '🎁 Оффер запущен от имени ' + profile.name + ': ' + result + '. Конец оффера ' + mskText(deadline) + ' МСК.' };
}

export function mskText(ms) {
  return new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
}

export async function stopOffer(bookingId, by, reason = 'manager') {
  const booking = await getBooking(bookingId);

  if (!booking || !booking.offer) return { ok: false, error: 'Цепочка по этой заявке не запускалась' };
  if (booking.offer.stopped) return { ok: true, message: 'Цепочка уже остановлена' };

  await updateBooking(booking.id, {
    offer: { ...booking.offer, stopped: true, stoppedAt: new Date().toISOString(), stoppedBy: by ? '@' + by : null, stopReason: reason }
  });

  return { ok: true, message: 'Цепочка остановлена' };
}

// Ответ клиента в боте ставит цепочку на паузу: дальше пишет менеджер.
export async function pauseOfferForChat(chatId) {
  const bid = (await kvGet(`relay:${chatId}`)) || (await kvGet(`user:${chatId}`));

  if (!bid) return;

  const booking = await getBooking(bid);

  if (!booking || !booking.offer || booking.offer.paused || booking.offer.stopped) return;
  if (booking.offer.sent && booking.offer.sent[4]) return;

  await updateBooking(booking.id, { offer: { ...booking.offer, paused: true, pausedAt: new Date().toISOString(), pauseReason: 'client_replied' } });
}

// Ответ кнопкой на сообщение 4.
export async function saveOfferReason(bookingId, code) {
  const booking = await getBooking(bookingId);

  if (!booking || !OFFER_REASONS[code]) return null;

  await updateBooking(booking.id, {
    offerReason: { code: Number(code), text: OFFER_REASONS[code], at: new Date().toISOString() },
    offer: booking.offer ? { ...booking.offer, paused: true, pauseReason: 'reason_answered' } : booking.offer
  });
  await addMessage(booking.id, { from: 'student', text: 'Что помешало: ' + OFFER_REASONS[code] });

  return booking;
}

// --- Крон: что отправить сейчас ---

export async function processOffer(booking, nowMs) {
  const offer = booking.offer;

  if (!offer || offer.stopped || offer.paused || offer.done) return 0;

  if (booking.introPaid) {
    await updateBooking(booking.id, { offer: { ...offer, done: true, doneReason: 'paid' } });
    return 0;
  }

  const D = new Date(offer.deadline).getTime();
  let sent = 0;
  let changed = false;

  for (const step of [1, 2, 3, 4]) {
    if (offer.sent[step] || offer.sent[step + '_skip']) continue;

    const planned = offer.plan[step] ? new Date(offer.plan[step]).getTime() : null;

    if (!planned) continue;
    if (nowMs < planned) break;

    // 1-3 после дедлайна не уходят; 4 не уходит, если менеджер сам прислал ссылку после запуска.
    const late = step < 4 && nowMs >= D;
    const manual = step === 4 && booking.lastManualPayLinkAt && booking.lastManualPayLinkAt > offer.startedAt;
    // Крон опоздал за пределы окна клиента - для 2 и 3 сообщение уже не к месту.
    const outOfWindow = (step === 2 || step === 3) && nowMs - planned > 3 * H;

    if (late || manual || outOfWindow) {
      offer.sent[step + '_skip'] = late ? 'deadline' : manual ? 'manual_link' : 'cron_late';
      changed = true;
      continue;
    }

    const channel = await sendStep(booking, step, nowMs);

    if (!channel) break;

    offer.sent[step] = new Date(nowMs).toISOString();
    changed = true;
    sent++;
  }

  // Писать в базу только если что-то поменялось: крон ходит каждые 5 минут,
  // а каждая запись - это две команды Upstash.
  if (!changed) return 0;

  const finished = offer.sent[4] || offer.sent['4_skip'];

  await updateBooking(booking.id, {
    offer: { ...offer, ...(finished ? { done: true } : {}) },
    ...(offer.sent[1] && !booking.payLinkSentAt ? { introSentAt: offer.sent[1], payLinkSentAt: offer.sent[1] } : {})
  });

  return sent;
}

// Напоминание менеджеру, если оффер не запущен: через 2 часа после «Пришёл»
// и следующим утром в 10:00 МСК.
export function offerReminderDue(booking, nowMs) {
  if (booking.attended !== true || booking.offer || booking.introPaid || booking.introSentAt) return 0;
  if (!booking.attendanceMarkedAt || booking.status === 'cancelled') return 0;

  const D = offerDeadlineMs(booking);

  if (!D || nowMs >= D) return 0;

  const marked = new Date(booking.attendanceMarkedAt).getTime();
  const stage = booking.offerRemindStage || 0;
  const m = new Date(marked + 3 * H);
  const nextMorning = Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate() + 1, 10 - 3, 0);

  // Отметили давно (например, вчера): одно напоминание, а не два подряд.
  if (stage < 1 && nowMs >= marked + 2 * H) return nowMs >= nextMorning ? 2 : 1;
  if (stage < 2 && nowMs >= nextMorning) return 2;

  return 0;
}
