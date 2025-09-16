import { NextResponse } from 'next/server';

import { captureOrder } from '@/lib/paypal';

export async function POST(request) {
  try {
    const { orderID } = await request.json();
    const data = await captureOrder(orderID);

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
