import { NextResponse } from 'next/server';
import {
  getBookedSlots, addBookedSlot,
  createBooking, setPendingBooking,
  getManagerChatId, kvGet
} from '@/lib/redis';
import { makeDeepLink, sendMessage, formatBookingForManager, managerActionsKeyboard, MANAGER_USERNAME } from '@/lib/telegram';
import { notifyManagers } from '@/lib/managers';
import { sendBookingConfirmation } from '@/lib/email';
import { sendLead } from '@/lib/meta';

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
    const { name, telegram, email, slot, slotMsk, slotDate, slotLocal, turnstileToken, quizAnswers, attribution, leadEventId } = body;

    // IP и User-Agent берём из заголовков запроса: клиент их не знает, а Мете
    // они нужны как есть, без хеширования — это заметно поднимает матчинг.
    const headers = request.headers;
    const forwarded = headers.get('x-forwarded-for') || '';
    const clientIp = forwarded.split(',')[0].trim() || headers.get('x-real-ip') || '';
    const clientUa = headers.get('user-agent') || '';

    // Validate
    if (!name) {
      return NextResponse.json({ error: 'Имя обязательно' }, { status: 400 });
    }
    // Раньше Telegram был единственным обязательным каналом — и именно он
    // ломался: без нажатия «Начать» в боте человек не получал ни подтверждения,
    // ни напоминаний. Теперь достаточно любого одного канала.
    if (!telegram && !email) {
      return NextResponse.json({ error: 'Укажите Telegram или email' }, { status: 400 });
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
      slotLocal: slotLocal || '',
      chatId: null,
      status: 'confirmed',
      reminded24h: false,
      reminded1h: false,
      quizAnswers: quizAnswers || {},
      attribution: { ...(attribution || {}), ip: clientIp, ua: clientUa },
      // Один и тот же id уходит с браузерным и серверным Lead — по нему Мета
      // склеивает два события в одно
      leadEventId: leadEventId || generateBookingId() + '-' + Date.now(),
      // Пояс клиента дублируем на верхний уровень: по нему все сообщения
      // пересчитывают время слота, в том числе после переноса из бота
      tz: (attribution && attribution.tz) || '',
      createdAt: new Date().toISOString()
    };

    await createBooking(booking);
    await setPendingBooking(bookingId, booking);

    // Lead в Meta — событие дня 0, по нему идёт оптимизация кампаний.
    // Браузер шлёт такое же с тем же leadEventId, Мета считает их за одно.
    try {
      await sendLead(booking);
    } catch (e) {
      console.error('CAPI lead error:', e);
    }

    // Письмо с подтверждением. Единственный канал, который не зависит от того,
    // нажал ли человек «Начать» в боте. Без RESEND_API_KEY вызов молча пропускается.
    // Результат отправки кладём в заявку: иначе «письмо не пришло» выясняется
    // только жалобой клиента, а менеджер об этом не знает.
    try {
      const mail = await sendBookingConfirmation(booking);
      booking.emailOk = Boolean(mail && mail.ok);
      booking.emailNote = (mail && (mail.skipped || mail.error)) || null;
    } catch (e) {
      console.error('Confirmation email error:', e);
      booking.emailOk = false;
      booking.emailNote = String(e).slice(0, 200);
    }

    await createBooking(booking);

    // Generate deep link
    const botLink = makeDeepLink(bookingId);

    // Notify manager immediately (even before user opens bot)
    try {
      const sent = await notifyManagers(formatBookingForManager(booking, 'new'), managerActionsKeyboard(bookingId));
      if (!sent) {
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
