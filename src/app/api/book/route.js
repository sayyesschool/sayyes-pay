import { NextResponse } from 'next/server';
import {
  getBookedSlots, addBookedSlot,
  createBooking, setPendingBooking, updateBooking,
  getManagerChatId, kvGet
} from '@/lib/redis';
import { makeDeepLink, sendMessage, formatBookingForManager, managerActionsKeyboard, MANAGER_USERNAME } from '@/lib/telegram';
import { notifyManagers } from '@/lib/managers';
import { sendBookingConfirmation } from '@/lib/email';
import { sendLead } from '@/lib/meta';
import { isSlotClosed } from '@/lib/capacity';

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

// Люди пишут в поле контакта что попало: почти половина — телефон, каждый
// седьмой — почту, кто-то имя или ссылку t.me. Раскладываем на сервере, а не
// требуем формата от человека. Исходное значение не трогаем: менеджер видит
// в карточке ровно то, что ввели.
function splitContact(raw, email) {
  const value = String(raw || '').trim();
  const digits = value.replace(/\D/g, '');
  const out = { phone: '', email: String(email || '').trim() };

  if (!value) return out;

  // Почта, вписанная в поле контакта: подхватываем, если своего email нет.
  if (!out.email && /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(value)) {
    out.email = value;

    return out;
  }

  // Телефон: с плюсом или без, лишь бы это были цифры, а не @handle.
  if (!value.startsWith('@') && digits.length >= 9 && digits.length <= 15) {
    out.phone = value.startsWith('+') ? value : '+' + digits;
  }

  return out;
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
      // Проверка на сервере, а не только в сетке: страница могла быть открыта
      // до того, как день закрыли, и человек выбрал бы час, когда вести урок некому.
      if (isSlotClosed(slot)) {
        return NextResponse.json({ error: 'Это время больше недоступно. Выберите другое.' }, { status: 409 });
      }

      const booked = await getBookedSlots();
      if (booked.includes(slot)) {
        return NextResponse.json({ error: 'Это время уже занято. Выберите другое.' }, { status: 409 });
      }
      await addBookedSlot(slot);
    }

    const contact = splitContact(telegram, email);

    // Create booking record
    const bookingId = generateBookingId();
    const booking = {
      id: bookingId,
      name,
      telegram: telegram || '',
      email: contact.email || '',
      phone: contact.phone || '',
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

    // Именно update, а не повторный create: запись уже создана выше.
    await updateBooking(bookingId, {
      emailOk: booking.emailOk,
      emailNote: booking.emailNote
    });

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
