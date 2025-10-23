import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { type, contact, channel, source, data } = await request.json();

    const response = await fetch('https://api.sayyes.school/request',{
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            type,
            contact,
            channel,
            source,
            data,
        })
    });

    const responseData = await response.json();

    console.log(responseData);

    return NextResponse.json({ status: 'success' });
  } catch (e) {
    return NextResponse.json({
      error: e.message
    }, {
      status: 500
    });
  }
}