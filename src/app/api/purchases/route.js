import { NextResponse } from 'next/server';

import { getPurchases } from '@/features/purchases/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');

  if (!email) {
    return NextResponse.json({
      error: 'Email required'
    }, {
      status: 400
    });
  }

  try {
    const purchases = await getPurchases({ email });

    return NextResponse.json({ purchases });
  } catch (error) {
    return NextResponse.json({
      error: error.message
    }, {
      status: 500
    });
  }
}
