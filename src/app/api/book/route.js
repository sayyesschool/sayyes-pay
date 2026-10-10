import { NextResponse } from 'next/server';
import {
  getBookedSlots, addBookedSlot,
  createBooking, setPendingBooking, updateBooking,
  getManagerChatId, kvGet, setUserBooking, clearPendingBooking
} from '@/lib/redis';
import {
  makeDeepLink, sendMessage, formatBookingForManager, managerActionsKeyboard, MANAGER_USERNAME,
  formatBookingConfirmation, bookingActionsKeyboard
} from '@/lib/telegram';
import { verifyInitData, tgDisplayName } from '@/lib/tgWebApp';
import { notifyManagers } from '@/lib/managers';
import { sendBookingConfirmation } from '@/lib/email';
import { sendLead, sendSchedule } from '@/lib/meta';
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
    const { slot, slotMsk, slotDate, slotLocal, turnstileToken, quizAnswers, leadEventId, tgInitData, tgWriteAccess } = body;
    let { name, telegram, email, attribution } = body;

    // Воронка открыта как Mini App внутри Telegram (с 10.10.2026). Экрана контактов
    // там нет: имя и аккаунт берём из подписанных данных Telegram. Подпись проверяем,
    // иначе любой мог бы записаться от чужого Telegram id.
    let tgUser = null;
    let tgChannel = '';

    if (tgInitData) {
      const tg = verifyInitData(tgInitData);

      if (!tg.ok) {
        return NextResponse.json({ error: 'Не удалось проверить данные Telegram. Откройте воронку заново из Telegram.' }, { status: 403 });
      }

      tgUser = tg.user;
      tgChannel = tg.startParam;
      name = name || tgDisplayName(tgUser) || (tgUser.username ? '@' + tgUser.username : 'Ученик из Telegram');
      telegram = telegram || (tgUser.username ? '@' + tgUser.username : '');
      attribution = {
        ...(attribution || {}),
        utm_source: 'telegram',
        utm_medium: 'tg_miniapp',
        ...(tgChannel ? { utm_campaign: tgChannel } : {})
      };
    }

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
    if (!telegram && !email && !tgUser) {
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
      ...(tgUser ? { tgUserId: String(tgUser.id), source: 'telegram', tgChannel: tgChannel || null } : {}),
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

    // Mini App: человек разрешил боту писать, значит чат можно связать сразу,
    // без нажатия Start. Личный чат с пользователем имеет тот же id, что и сам
    // пользователь. Подтверждение уходит в бот до того, как Mini App закроется.
    let tgLinked = false;

    if (tgUser && tgWriteAccess) {
      try {
        const chatId = String(tgUser.id);
        // Сначала сообщение, потом привязка: если Telegram писать не дал,
        // чат в заявку не пишем, иначе напоминания молча уходили бы в никуда.
        const sent = await sendMessage(chatId, formatBookingConfirmation(booking), bookingActionsKeyboard(bookingId));

        tgLinked = Boolean(sent && sent.ok);

        if (tgLinked) {
          await updateBooking(bookingId, { chatId });
          await setUserBooking(chatId, bookingId);
          await clearPendingBooking(bookingId);

          // Schedule в Мете: запись подтверждена в боте, так же как после Start.
          try {
            const res = await sendSchedule({ ...booking, chatId });
            if (res && res.ok) await updateBooking(bookingId, { scheduleSent: true });
          } catch (e) {
            console.error('CAPI schedule error:', e);
          }
        }
      } catch (e) {
        console.error('Mini App chat link error:', e);
      }
    }

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
      botLink,
      tgLinked
    });
  } catch (e) {
    console.error('Booking error:', e);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
