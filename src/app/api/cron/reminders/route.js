import { NextResponse } from 'next/server';
import { getAllActiveBookings, updateBooking } from '@/lib/redis';
import { sendMessage, formatReminder, formatHandout, bookingActionsKeyboard } from '@/lib/telegram';
import { sendHandoutEmail } from '@/lib/email';

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

    for (const booking of bookings) {
      if (!booking.slot || booking.slot === 'no_time') continue;

      // Parse slot time (MSK)
      const [dateStr, time] = booking.slot.split('_');
      const [h, m] = time.split(':').map(Number);

      // Create slot datetime in UTC (MSK is UTC+3)
      const slotDate = new Date(`${dateStr}T${String(h - 3).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
      const hoursUntil = (slotDate - now) / (1000 * 60 * 60);

      // Send 24h reminder (between 23-25 hours before)
      if (booking.chatId && !booking.reminded24h && hoursUntil > 23 && hoursUntil < 25) {
        await sendMessage(
          booking.chatId,
          formatReminder(booking, 24),
          bookingActionsKeyboard(booking.id)
        );
        await updateBooking(booking.id, { reminded24h: true });
        sent24h++;
      }

      // Send 1h reminder (between 0.5-1.5 hours before)
      if (booking.chatId && !booking.reminded1h && hoursUntil > 0.5 && hoursUntil < 1.5) {
        await sendMessage(
          booking.chatId,
          formatReminder(booking, 1),
          bookingActionsKeyboard(booking.id)
        );
        await updateBooking(booking.id, { reminded1h: true });
        sent1h++;
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
            await sendMessage(booking.chatId, formatHandout(booking), bookingActionsKeyboard(booking.id));
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
    }

    return NextResponse.json({
      ok: true,
      checked: bookings.length,
      sent24h,
      sent1h,
      sentHandout,
      timestamp: now.toISOString()
    });
  } catch (e) {
    console.error('Reminder cron error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
