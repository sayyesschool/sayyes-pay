import { NextResponse } from 'next/server';

import { getBooking } from '@/lib/redis';
import { getProducts } from '@/services/stripe';
import { getIntroProducts, introActive, introExpiry } from '@/services/intro';

// Почту целиком наружу не отдаём, но человек должен узнать свою и заметить
// опечатку — иначе чек уйдёт в никуда и он об этом не узнает.
// Код записи — восемь символов, их можно перебирать. Данных здесь мало
// (только маска почты), но скорость перебора ограничиваем. Память у каждого
// инстанса своя — это не защита, а тормоз для скрипта.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;
const hits = new Map();

function tooManyLookups(ip) {
  const now = Date.now();
  const seen = (hits.get(ip) || []).filter(time => now - time < RATE_WINDOW_MS);

  seen.push(now);
  hits.set(ip, seen);

  if (hits.size > 5000) hits.clear();

  return seen.length > RATE_LIMIT;
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');

  if (!local || !domain) return null;

  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

export async function GET(request) {
  try {
    const products = await getProducts({
      limit: 50,
      active: true
    });

    // Ссылка от менеджера приходит с кодом записи. Только по нему сюда
    // попадают интро-офферы: обычный посетитель сайта их не увидит.
    const bookingId = request.nextUrl.searchParams.get('b');
    let booking = null;

    const ip = request.headers.get('x-forwarded-for') || 'unknown';

    if (bookingId && !tooManyLookups(ip)) {
      try {
        booking = await getBooking(bookingId);
      } catch (e) {
        console.error('Booking lookup error:', e);
      }
    }

    const intro = booking && introActive(booking) ? await getIntroProducts() : [];
    const expiry = intro.length ? introExpiry(booking) : null;

    return NextResponse.json({
      products: products.concat(intro),
      // Почту наружу не отдаём — только признак, что она у нас есть.
      // По нему страница решает, спрашивать её у человека ещё раз или нет.
      booking: booking ? {
        hasEmail: Boolean(booking.email),
        emailHint: maskEmail(booking.email)
      } : null,
      introExpiresAt: expiry ? expiry.toISOString() : null
    });
  } catch (e) {
    return NextResponse.json({
      error: e.message
    }, {
      status: 500
    });
  }
}
