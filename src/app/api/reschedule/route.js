import { NextResponse } from 'next/server';
import {
  getBooking, updateBooking, getBookedSlots, removeBookedSlot, addBookedSlot,
  getManagerChatId
} from '@/lib/redis';
import { sendMessage, formatBookingForManager, managerActionsKeyboard, bookingActionsKeyboard } from '@/lib/telegram';

export async function POST(request) {
  try {
    const body = await request.json();
    const { bookingId, slot, slotMsk, slotDate, slotLocal } = body;

    if (!bookingId || !slot) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const booking = await getBooking(bookingId);
    if (!booking) {
      return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 });
    }
    if (booking.status !== 'confirmed') {
      return NextResponse.json({ error: 'Запись недействительна' }, { status: 400 });
    }

    // Check if new slot is available
    const bookedSlots = await getBookedSlots();
    if (bookedSlots.includes(slot)) {
      return NextResponse.json({ error: 'Это время уже занято. Выберите другое.' }, { status: 409 });
    }

    // Free old slot
    if (booking.slot && booking.slot !== 'no_time') {
      await removeBookedSlot(booking.slot);
    }

    // Book new slot
    await addBookedSlot(slot);

    // Update booking
    const updated = await updateBooking(bookingId, {
      slot,
      slotMsk: slotMsk || '',
      slotDate: slotDate || '',
      slotLocal: slotLocal || '',
      reminded24h: false,
      reminded1h: false
    });

    // Notify client in Telegram (if they linked the bot)
    if (booking.chatId) {
      const clientTime = slotLocal || slotMsk || '—';
      const timeLabel = slotLocal ? 'Время' : 'Время (МСК)';
      await sendMessage(
        booking.chatId,
        `🔄 <b>Запись перенесена!</b>\n\n` +
        `📅 Дата: <b>${slotDate || '—'}</b>\n` +
        `🕐 ${timeLabel}: <b>${clientTime}</b>\n` +
        `📹 Формат: Консультация · 30 мин · Zoom\n\n` +
        `Ссылку на Zoom пришлём за час до начала.`,
        bookingActionsKeyboard(bookingId)
      );
    }

    // Notify manager
    const managerChatId = await getManagerChatId();
    if (managerChatId && updated) {
      await sendMessage(managerChatId, formatBookingForManager(updated, 'reschedule'), managerActionsKeyboard(bookingId));
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Reschedule error:', e);
    return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 });
  }
}
