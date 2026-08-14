import { NextResponse } from 'next/server';

import { captureOrder } from '@/services/paypal';
import { sendPurchase } from '@/lib/meta';

export async function POST(request) {
  try {
    const { orderID } = await request.json();
    const data = await captureOrder(orderID);

      // Purchase в Meta Conversions API — то же, что и для Stripe.
      try {
        const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
        const money = capture?.amount;
        await sendPurchase({
          email: data?.payer?.email_address,
          value: money ? Number(money.value) : 0,
          currency: money?.currency_code || 'EUR',
          eventId: 'paypal_' + (data?.id || orderID),
          sourceUrl: 'https://sayyes.school/'
        });
      } catch (e) {
        console.error('CAPI purchase (paypal) error:', e);
      }

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({
      error: 'Failed to capture PayPal order',
      details: error.message
    }, {
      status: 500
    });
  }
}
