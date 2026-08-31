import { NextResponse } from 'next/server';

import { getBooking } from '@/lib/redis';
import { createCheckoutSession } from '@/services/stripe';
import { introActive, isIntroPriceId } from '@/services/intro';

export async function POST(request) {
  try {
    const { email, price_id, booking_id } = await request.json();

    if (!price_id) {
      return NextResponse.json({
        error: "Не передан price_id"
      }, {
        status: 400
      });
    }

    const booking = booking_id ? await getBooking(booking_id) : null;

    // Почту второй раз не спрашиваем: если человек пришёл по ссылке менеджера,
    // она уже есть в заявке.
    const customerEmail = email || booking?.email;

    if (!customerEmail) {
      return NextResponse.json({
        error: "Нет email"
      }, {
        status: 400
      });
    }

    // Спецпредложение живёт ограниченное время. Проверка именно здесь, а не только
    // в интерфейсе: ссылка остаётся в переписке и её легко открыть через неделю.
    if (await isIntroPriceId(price_id)) {
      if (!booking) {
        return NextResponse.json({
          error: "Спецпредложение доступно только по ссылке от менеджера",
          notice: "Это спецпредложение доступно только по персональной ссылке от менеджера. Напишите нам в Telegram, и мы пришлём её."
        }, {
          status: 403
        });
      }

      if (!introActive(booking)) {
        return NextResponse.json({
          error: "Срок действия спецпредложения истёк. Напишите менеджеру — он пришлёт новую ссылку.",
          notice: "Срок действия спецпредложения истёк. Напишите менеджеру в Telegram — он пришлёт новую ссылку."
        }, {
          status: 403
        });
      }
    }

    const origin = request.headers.get('origin') || '';
    const { url, client_secret } = await createCheckoutSession({
      email: customerEmail,
      price_id,
      baseUrl: origin
    }, booking_id);

    return NextResponse.json({
      url,
      clientSecret: client_secret
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
