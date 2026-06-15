import { NextResponse } from 'next/server';
import {
  getBookedSlots, addBookedSlot,
  createBooking, setPendingBooking,
  getManagerChatId, kvGet
} from '@/lib/redis';
import { makeDeepLink, sendMessage, formatBookingForManager, MANAGER_USERNAME } from '@/lib/telegram';

// Generate short unique booking ID
function generateBookingId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// Verify Cloudflare Turnstile token
async function verifyTurnstile(token) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return true;

  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token })
    });
    const data = await resp.json();
    return data.success;
  } catch (e) {
    console.error('Turnstile verification error:', e);
    return true;
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, telegram, email, slot, slotMsk, slotDate, turnstileToken, quizAnswers } = body;

    // Validate
    if (!name) {
      return NextResponse.json({ error: 'Имя обязательно' }, { status: 400 });
    }
    if (!telegram) {
      return NextResponse.json({ error: 'Укажите Telegram или номер телефона' }, { status: 400 });
    }

    // Verify CAPTCHA
    const captchaValid = await verifyTurnstile(turnstileToken);
    if (!captchaValid) {
      return NextResponse.json({ error: 'Проверка не пройдена. Попробуйте ещё раз.' }, { status: 403 });
    }

    // Check & book slot
    if (slot && slot !== 'no_time') {
      const booked = await getBookedSlots();
      if (booked.includes(slot)) {
        return NextResponse.json({ error: 'Это время уже занято. Выберите другое.' }, { status: 409 });
      }
      await addBookedSlot(slot);
    }

    // Create booking record
    const bookingId = generateBookingId();
    const booking = {
      id: bookingId,
      name,
      telegram: telegram || '',
      email: email || '',
      slot: slot || 'no_time',
      slotMsk: slotMsk || '',
      slotDate: slotDate || '',
      chatId: null,
      status: 'confirmed',
      reminded24h: false,
      reminded1h: false,
      quizAnswers: quizAnswers || {},
      createdAt: new Date().toISOString()
    };

    await createBooking(booking);
    await setPendingBooking(bookingId, booking);

    // Generate deep link
    const botLink = makeDeepLink(bookingId);

    // Notify manager immediately (even before user opens bot)
    try {
      let managerChatId = await getManagerChatId();
      // Fallback: look up by username in case manager hasn't re-sent /start
      if (!managerChatId) {
        managerChatId = await kvGet(`user_chat:${MANAGER_USERNAME.toLowerCase()}`);
      }
      if (managerChatId) {
        await sendMessage(managerChatId, formatBookingForManager(booking, 'new'));
      } else {
        console.warn('Manager chat ID not found — manager will not receive notification');
      }
    } catch (e) {
      console.error('Manager notification error:', e);
    }

    return NextResponse.json({
      success: true,
      bookingId,
      botLink
    });
  } catch (e) {
    console.error('Booking error:', e);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
