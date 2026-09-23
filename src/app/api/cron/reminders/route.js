import { NextResponse } from 'next/server';
import { getAllActiveBookings, updateBooking, getManagerChatId, removeBookedSlot, kvGet, kvSet } from '@/lib/redis';
import { sendMessage, formatReminder, formatHandout, bookingActionsKeyboard, formatAttendanceAsk, attendanceKeyboard, formatManagerCard, managerActionsKeyboard } from '@/lib/telegram';
import { notifyManagers, notifyHost } from '@/lib/managers';
import { sendHandoutEmail, sendConfirmRequestEmail, sendLessonReminderEmail, sendReviveEmail, sendSlotReleasedEmail } from '@/lib/email';
import { reviveTelegram, reviveKeyboard, reviveDueAt } from '@/lib/revive';

// Protect cron endpoint
const CRON_SECRET = process.env.CRON_SECRET;

// Сторож воронки. 21.09.2026 правка в learn_easy.html уронила JS на первом же
// экране: страница открывалась, но ни один шаг не считался и ни одна заявка
// не доходила. Реклама крутилась двое суток вхолостую — 237 кликов, 0 заявок,
// и заметили это только потому, что Дима посмотрел на цифры руками.
//
// Признак поломки простой и не требует браузера: у живой воронки открытия
// страницы идут весь день. Ноль открытий с начала суток при живом вчера —
// это не «плохой день», это сломанная страница.
async function watchFunnel() {
  try {
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const hour = now.getUTCHours();

    // Ночью трафика нет и без поломки. Проверяем в те часы, когда реклама
    // заведомо крутится: 11:00–23:00 по расписанию школы.
    if (hour < 11) return null;

    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const alertKey = 'funnel_alert:' + today;

    if (await kvGet(alertKey)) return null;

    const [rowToday, rowYesterday] = await Promise.all([
      kvGet('track:' + today),
      kvGet('track:' + yesterday)
    ]);

    const opened = Number((rowToday && rowToday.landing) || 0);
    const openedBefore = Number((rowYesterday && rowYesterday.landing) || 0);

    // Вчера тоже ноль — значит либо реклама выключена, либо поломка уже
    // не новость: об этом сообщили вчера. Второй раз не шумим.
    if (opened > 0 || openedBefore < 20) return null;

    await kvSet(alertKey, new Date().toISOString(), 60 * 60 * 48);

    await notifyManagers(
      '⚠️ <b>Воронка молчит</b>\n\n' +
      'С начала суток ноль открытий страницы, вчера их было ' + openedBefore + '.\n' +
      'Скорее всего страница сломана и реклама идёт впустую.\n\n' +
      'Проверить: откройте https://www.sayyestoenglish.com/learn_easy и посмотрите, ' +
      'листаются ли экраны.'
    );

    return { opened, openedBefore, alerted: true };
  } catch (e) {
    console.error('Funnel watch error:', e);

    return null;
  }
}

export async function GET(request) {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const bookings = await getAllActiveBookings();
    const now = new Date();
    let sent24h = 0;
    let sent1h = 0;
    let sentHandout = 0;
    let askedAttendance = 0;
    let briefedHost = 0;
    let released = 0;
    let mailed = 0;
    let revived = 0;

    for (const booking of bookings) {
      if (!booking.slot || booking.slot === 'no_time') continue;

      // Время слота в базовом поясе расписания (UTC+3).
      const [dateStr, time] = booking.slot.split('_');
      const [h, m] = time.split(':').map(Number);

      // Вычитать 3 из часа прямо в строке нельзя: у ночных слотов получалось
      // «T-2:30:00Z», Date выходил невалидным, и по такой записи молча
      // переставали уходить и напоминания, и вопрос о явке. Считаем в миллисекундах.
      const slotDate = new Date(`${dateStr}T00:00:00Z`);

      if (Number.isNaN(slotDate.getTime())) continue;

      slotDate.setTime(slotDate.getTime() + ((h - 3) * 60 + m) * 60 * 1000);

      const hoursUntil = (slotDate - now) / (1000 * 60 * 60);

      // Окна намеренно широкие, а не «ровно за сутки». GitHub Actions на бесплатном
      // тарифе выполняет расписание не каждые 15 минут, как записано, а раз в 4–5 часов:
      // 2 сентября запуски были в 07:06, 11:39 и 15:52. Узкое двухчасовое окно такой
      // планировщик просто перепрыгивает, и напоминание не уходит вообще.
      // От повторов защищает флаг reminded24h, а не ширина окна.
      if (booking.chatId && !booking.reminded24h && hoursUntil > 1.5 && hoursUntil < 25) {
        // За сутки просим явного «буду»: без него мы не знаем, кто придёт,
        // а человек не делает ни одного действия между заявкой и уроком.
        await sendMessage(
          booking.chatId,
          formatReminder(booking, 24) +
            (booking.confirmed ? '' : '\n\nНажмите «Буду на уроке» — так мы поймём, что время в силе, и не отдадим его другому.'),
          bookingActionsKeyboard(booking.id, booking)
        );
        await updateBooking(booking.id, { reminded24h: true });
        sent24h++;
      }

      // Тем, у кого нет чата с ботом, то же самое письмом. Без этого человек
      // между заявкой и уроком не получал от нас ни одного касания.
      if (!booking.chatId && booking.email && !booking.mailed24h && hoursUntil > 1.5 && hoursUntil < 25) {
        // Флаг ставим только если письмо реально ушло. 18.09.2026 у почтового
        // провайдера кончились кредиты — письма падали, а флаг вставал, и крон
        // к этим людям больше не возвращался. Поломка почты не должна навсегда
        // съедать касание.
        const mail = await sendConfirmRequestEmail(booking);

        if (mail && mail.ok) {
          await updateBooking(booking.id, { mailed24h: true });
          mailed++;
        }
      }

      // Второе касание для тех, у кого только почта. По данным за 19 сентябрьских
      // дней они подтверждают втрое хуже владельцев бота — 18% против 61%, — но
      // если всё-таки подтвердили, доходят почти так же (50% против 63%).
      // То есть теряем мы их на канале, а не на нежелании: одного письма за сутки
      // им мало. Окно 6,5–14 часов подобрано так, чтобы письмо успело уйти
      // ДО автоснятия неподтверждённых, которое срабатывает за 6 часов до урока.
      if (!booking.chatId && booking.email && !booking.confirmed && !booking.mailed12h
        && hoursUntil > 6.5 && hoursUntil < 14) {
        const mail = await sendConfirmRequestEmail(booking);

        if (mail && mail.ok) {
          await updateBooking(booking.id, { mailed12h: true });
          mailed++;
        }
      }


      // Send 1h reminder (between 0.5-1.5 hours before)
      // Записался впритык — шлём ПАМЯТКУ вместо напоминания, а не оба сразу.
      // В памятке есть всё то же — время, ссылка, кнопки — плюс причина прийти.
      // Напоминание без памятки — это те же строки минус единственное, ради чего стоит писать.
      if (booking.chatId && !booking.reminded1h && hoursUntil > 0 && hoursUntil < 2) {
        const handoutInstead = !booking.handoutSent;

        await sendMessage(
          booking.chatId,
          handoutInstead ? formatHandout(booking) : formatReminder(booking, 1),
          bookingActionsKeyboard(booking.id, booking)
        );
        await updateBooking(booking.id, handoutInstead
          ? { reminded1h: true, handoutSent: true }
          : { reminded1h: true });
        sent1h++;
      }

      if (!booking.chatId && booking.email && !booking.mailed1h && hoursUntil > 0 && hoursUntil < 2) {
        const handoutInstead = !booking.handoutSent;

        if (handoutInstead) await sendHandoutEmail(booking);
        else await sendLessonReminderEmail(booking, 1);

        await updateBooking(booking.id, handoutInstead
          ? { mailed1h: true, handoutSent: true }
          : { mailed1h: true });
        mailed++;
      }

      // Памятка «Как заговорить без стеснения» — отдельное касание перед уроком.
      // Оно не зависит от того, открыл ли человек бота: у кого есть только почта,
      // письмо всё равно уйдёт.
      // Записался заранее — шлём за сутки до урока. Записался впритык — через 2,5 часа
      // после записи. Ближе чем за полтора часа до начала уже не шлём: это спам.
      if (!booking.handoutSent && hoursUntil > 1.5) {
        const createdAt = booking.createdAt ? new Date(booking.createdAt) : null;
        const leadHours = createdAt ? (slotDate - createdAt) / (1000 * 60 * 60) : 0;
        const dueAt = leadHours > 24
          ? new Date(slotDate.getTime() - 24 * 60 * 60 * 1000)
          : (createdAt ? new Date(createdAt.getTime() + 2.5 * 60 * 60 * 1000) : null);

        if (dueAt && now >= dueAt) {
          let delivered = false;

          if (booking.chatId) {
            await sendMessage(booking.chatId, formatHandout(booking), bookingActionsKeyboard(booking.id, booking));
            delivered = true;
          }

          if (booking.email) {
            try {
              const mail = await sendHandoutEmail(booking);

              if (mail && mail.ok) delivered = true;
            } catch (e) {
              console.error('Handout email error:', e);
            }
          }

          // Хотя бы один канал сработал — касание состоялось. Если не сработал
          // ни один, флаг не ставим: крон попробует снова в следующий час.
          if (delivered) {
            await updateBooking(booking.id, { handoutSent: true });
            sentHandout++;
          }
        }
      }

      // Бриф ведущей за 15 минут до звонка: карточка с ответами из воронки,
      // чтобы на урок не заходили вслепую. Окно широкое (5–40 минут), потому что
      // крон дёргается раз в 15 минут и GitHub Actions регулярно опаздывает.
      const minutesUntil = hoursUntil * 60;
      if (!booking.hostBriefed && minutesUntil > -15 && minutesUntil < 90) {
        const briefed = await notifyHost(
          `⏰ <b>Пробный урок через ${Math.round(minutesUntil)} мин</b>\n\n` + formatManagerCard(booking),
          managerActionsKeyboard(booking.id)
        );
        if (briefed) {
          await updateBooking(booking.id, { hostBriefed: true });
          briefedHost++;
        }
      }

      // Автоснятие неподтверждённых записей за 6 часов до урока. Правило отключали
      // 1 сентября: оно сняло двух живых учеников, которые просто не нажали кнопку.
      // 9 сентября вернули с оговоркой — если человек записался меньше чем за
      // 8 часов до урока, снимать нельзя: просьбу подтвердить шлют за сутки,
      // и подтвердить он физически не успевал.
      // Отсчёт ведём от последнего действия с записью, а не от первой заявки.
      // 22.09.2026 ученица записалась 5 сентября и перенесла урок на тот же день:
      // разница «заявка — урок» вышла в сотни часов, защита не сработала,
      // и автоматика сняла запись, на которую человек в итоге пришёл.
      // После переноса человек в том же положении, что и при новой записи:
      // просьбу подтвердить он получает заново, и времени у него столько же.
      const startedAt = booking.rescheduledAt || booking.createdAt;
      const createdAtMs = startedAt ? new Date(startedAt).getTime() : null;
      const leadHours = createdAtMs ? (slotDate.getTime() - createdAtMs) / (1000 * 60 * 60) : 999;

      // Вернули руками — больше не трогаем. 16.09.2026 это стоило трёх живых уроков:
      // Дима вернул записи через /restore, а крон в ту же минуту снял их снова — урок
      // ближе шести часов, подтверждения нет, условие сошлось. Получилась петля,
      // и ученикам каждый раз уходило письмо «мы освободили ваше время».
      // Решение человека всегда старше автоматики.
      if (!booking.confirmed
        && !booking.releasedUnconfirmed
        && !booking.restoredAt
        && booking.status !== 'cancelled'
        && leadHours >= 8
        && hoursUntil > 0 && hoursUntil < 6) {
        await updateBooking(booking.id, {
          status: 'cancelled',
          releasedUnconfirmed: true,
          releasedAt: new Date().toISOString()
        });

        if (booking.slot && booking.slot !== 'no_time') await removeBookedSlot(booking.slot);

        // Человеку — не выговор, а способ вернуться: ссылка открывает воронку
        // сразу на выборе времени, квиз он проходить второй раз не будет.
        const again = 'https://www.sayyestoenglish.com/learn_easy?reschedule=' + booking.id;

        if (booking.chatId) {
          await sendMessage(booking.chatId,
            'Мы освободили ваше время: подтверждения так и не было, а желающих на пробный урок больше, чем мест.\n\n' +
            'Если планы в силе, выберите новое время — это минута:\n' + again);
        } else if (booking.email) {
          try {
            await sendSlotReleasedEmail(booking, again);
          } catch (e) {
            console.error('Release email error:', e);
          }
        }

        await notifyManagers(
          '🕕 <b>Снята неподтверждённая запись</b>\n\n' + formatManagerCard(booking) +
          '\n\nВернуть: <code>/restore</code>'
        );

        released++;

        continue;
      }

      // Спрашиваем трижды: через час, через четыре и через сутки. Одного вопроса
      // не хватало — 31 августа из 19 уроков десять остались без отметки, а без неё
      // нет ни StartTrial в рекламе, ни окна спецпредложения у ученика.
      const noMark = booking.attended === undefined || booking.attended === null;

      if (noMark && hoursUntil < -1 && hoursUntil > -72) {
        const stage = hoursUntil <= -24 ? 3 : (hoursUntil <= -4 ? 2 : 1);

        if ((booking.attendanceAskedStage || 0) < stage) {
          const asked = await notifyManagers(
            formatAttendanceAsk(booking) + (stage > 1 ? '\n\n⚠️ Урок до сих пор без отметки.' : ''),
            attendanceKeyboard(booking.id)
          );

          if (asked) {
            await updateBooking(booking.id, { attendanceAsked: true, attendanceAskedStage: stage });
            askedAttendance++;
          }
        }
      }

      // Реанимация не пришедших: три касания от МОМЕНТА ОТМЕТКИ, +1, +4 и +11 дней.
      // Отсчёт от отметки, а не от урока, потому что отмечают руками и с задержкой —
      // иначе у поздно отмеченных первые два письма ушли бы одной пачкой.
      // Цепочка пишет живым людям сразу в два канала, поэтому включается отдельно:
      // REVIVE_ENABLED=1 в переменных окружения. Без неё код живёт, но молчит —
      // тексты сначала смотрят глазами через /revive в боте.
      if (process.env.REVIVE_ENABLED === '1'
        && booking.attended === false && !booking.reviveStopped && (booking.reviveStep || 0) < 3) {
        let startedAt = booking.reviveStartAt ? new Date(booking.reviveStartAt).getTime() : 0;

        if (!startedAt) {
          const marked = booking.attendanceMarkedAt
            ? new Date(booking.attendanceMarkedAt).getTime()
            : now.getTime();

          // Накопленная база: отметка стоит давно, но цепочка для неё начинается сейчас.
          startedAt = (now.getTime() - marked) > 24 * 60 * 60 * 1000
            ? now.getTime() - 24 * 60 * 60 * 1000
            : marked;

          await updateBooking(booking.id, { reviveStartAt: new Date(startedAt).toISOString() });
        }

        // Записался заново — цепочка про «ваше место осталось за вами» становится ложью.
        const mail = String(booking.email || '').trim().toLowerCase();
        const tg = String(booking.telegram || '').trim().toLowerCase();
        const rebooked = bookings.some(other => other.id !== booking.id
          && other.status !== 'cancelled'
          && new Date(other.createdAt || 0).getTime() > startedAt
          && ((mail && String(other.email || '').trim().toLowerCase() === mail)
            || (tg && String(other.telegram || '').trim().toLowerCase() === tg)));

        if (rebooked) {
          await updateBooking(booking.id, { reviveStopped: true, reviveStopReason: 'rebooked' });
        } else {
          const step = (booking.reviveStep || 0) + 1;

          if (now.getTime() >= reviveDueAt(startedAt, step)) {
            if (booking.chatId) {
              const parts = reviveTelegram(booking, step, startedAt);

              for (let i = 0; i < parts.length; i++) {
                const last = i === parts.length - 1;

                await sendMessage(booking.chatId, parts[i], last ? reviveKeyboard(booking) : {});
              }
            }

            if (booking.email) await sendReviveEmail(booking, step, startedAt);

            await updateBooking(booking.id, {
              reviveStep: step,
              reviveSentAt: new Date().toISOString()
            });

            revived++;
          }
        }
      }
    }

    const funnelAlert = await watchFunnel();

    return NextResponse.json({
      ok: true,
      checked: bookings.length,
      funnelAlert,
      sent24h,
      sent1h,
      sentHandout,
      askedAttendance,
      mailed,
      revived,
      briefedHost,
      released,
      timestamp: now.toISOString()
    });
  } catch (e) {
    console.error('Reminder cron error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
