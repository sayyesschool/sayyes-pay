import { NextResponse } from 'next/server';

import { getProducts } from '@/features/products/server';

export async function GET() {
  try {
    const products = await getProducts({
      limit: 50,
      active: true
    });

    return NextResponse.json({ products });
  } catch (e) {
    return NextResponse.json({
      error: e.message
    }, {
      status: 500
    });
  }
}