import { NextResponse } from 'next/server';

import { sendSiteRequestEmail } from '@/lib/email';

// Заявка с формы на главной странице.
//
// Раньше здесь была одна отправка — во внешний бэкенд школы, и её результат
// нигде не проверялся: что бы api.sayyes.school ни ответил, форма показывала
// «Заявка принята». Сломайся тот бэкенд — заявки исчезали бы бесследно.
// Теперь каналов два и они независимы: пересылка как была плюс письмо в школу.
const UPSTREAM = 'https://api.sayyes.school/request';

async function forward(payload) {
  const response = await fetch(UPSTREAM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');

    throw new Error('upstream ' + response.status + ' ' + text.slice(0, 200));
  }

  return response.json().catch(() => ({}));
}

export async function POST(request) {
  try {
    const { type, contact, channel, source, data } = await request.json();
    const lead = {
      name: contact && contact.name,
      phone: contact && contact.phone,
      channel
    };

    const [upstream, mail] = await Promise.allSettled([
      forward({ type, contact, channel, source, data }),
      sendSiteRequestEmail(lead)
    ]);

    if (upstream.status === 'rejected') {
      console.error('Request forward failed:', String(upstream.reason).slice(0, 300));
    }

    const mailOk = mail.status === 'fulfilled' && mail.value && mail.value.ok;

    if (!mailOk) {
      console.error('Request mail failed:', JSON.stringify(
        mail.status === 'fulfilled' ? mail.value : String(mail.reason).slice(0, 300)
      ));
    }

    // Человеку всё равно отвечаем успехом: он свою часть сделал, а разбираться
    // с упавшим каналом — наша забота. Но в логах видно, что именно не дошло.
    return NextResponse.json({
      status: 'success',
      delivered: {
        upstream: upstream.status === 'fulfilled',
        mail: Boolean(mailOk)
      }
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
