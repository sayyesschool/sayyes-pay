import { NextResponse } from 'next/server';

import { createCheckoutSession } from '@/features/checkout/server';

export async function POST(request) {
  try {
    const { email, price_id } = await request.json();

    if (!email) {
      return NextResponse.json({
        error: "Нет email. Сначала войдите."
      }, {
        status: 400
      });
    }

    if (!price_id) {
      return NextResponse.json({
        error: "Не передан price_id."
      }, {
        status: 400
      });
    }

    const origin = request.headers.get('origin') || '';
    const { url } = await createCheckoutSession({
      email,
      price_id,
      baseUrl: origin
    });

    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
