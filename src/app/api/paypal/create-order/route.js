import { NextResponse } from 'next/server';

import { createOrder } from '@/services/paypal';

export async function POST(request) {
  try {
    const data = await request.json();
    const order = await createOrder(data);

    return NextResponse.json({ data: order });
  } catch (error) {
    return NextResponse.json({
      error: 'Unexpected server error',
      details: error.message
    }, {
      status: 500
    });
  }
}
