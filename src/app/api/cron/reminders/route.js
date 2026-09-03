import { NextResponse } from 'next/server';
import { getAllActiveBookings, updateBooking, getManagerChatId, removeBookedSlot } from '@/lib/redis';
import { sendMessage, formatReminder, formatHandout, bookingActionsKeyboard, formatAttendanceAsk, attendanceKeyboard, formatManagerCard, managerActionsKeyboard } from '@/lib/telegram';
import { notifyManagers, notifyHost } from '@/lib/managers';
import { sendHandoutEmail, sendConfirmRequestEmail, sendLessonReminderEmail } from '@/lib/email';

// Protect cron endpoint
const CRON_SECRET = process.env.CRON_SECRET;

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
        await sendConfirmRequestEmail(booking);
        await updateBooking(booking.id, { mailed24h: true });
        mailed++;
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
          if (booking.chatId) {
            await sendMessage(booking.chatId, formatHandout(booking), bookingActionsKeyboard(booking.id, booking));
          }
          if (booking.email) {
            try {
              await sendHandoutEmail(booking);
            } catch (e) {
              console.error('Handout email error:', e);
            }
          }
          await updateBooking(booking.id, { handoutSent: true });
          sentHandout++;
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

      // Автоснятие неподтверждённых записей за 6 часов ОТКЛЮЧЕНО 1 сентября.
      // Оно вводилось, когда расписание было забито заявками из СНГ и слоты
      // стоили времени ведущей. Сейчас записей мало, и цена ошибки развернулась:
      // 1 сентября правило сняло двух живых учеников, которые просто не нажали
      // кнопку. Подтверждение по-прежнему запрашиваем — но слот держим за человеком.

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
    }

    return NextResponse.json({
      ok: true,
      checked: bookings.length,
      sent24h,
      sent1h,
      sentHandout,
      askedAttendance,
      mailed,
      briefedHost,
      released,
      timestamp: now.toISOString()
    });
  } catch (e) {
    console.error('Reminder cron error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
