// Клик по кнопке на лендинге womenabroad: заявки ещё нет, но идентификаторы клика
// есть только здесь и восстановить их потом невозможно. Поэтому в момент клика
// сохраняем связку под коротким токеном и отдаём его лендингу — он подставит токен
// в ссылку на бота. Дальше бот поднимет связку по токену и заведёт заявку.
//
// Payload диплинка Telegram — 64 символа и алфавит A-Za-z0-9_-, поэтому fbc
// (в нём точки и он длинный) в ссылку положить нельзя, только токен.

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { kvSet } from '@/lib/redis';
import { sendCapiEvent } from '@/lib/meta';
import { makeDeepLink } from '@/lib/telegram';

// Связка живёт 90 дней — столько же, сколько идентификаторы на самом лендинге,
// и с запасом перекрывает цикл сделки 7–30 дней.
const TTL_SECONDS = 90 * 24 * 60 * 60;

const ALLOWED_ORIGINS = [
  'https://womenabroad.sayyes.school',
  'https://www.womenabroad.sayyes.school'
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

// 20 символов из A-Za-z0-9_- — влезает в payload с запасом
function makeToken() {
  return crypto.randomBytes(15).toString('base64url');
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || '';
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request) {
  const origin = request.headers.get('origin') || '';
  const headers = corsHeaders(origin);

  try {
    const body = await request.json().catch(() => ({}));

    // IP и User-Agent берём из заголовков: клиент их не знает, а матчинг они поднимают
    const forwarded = request.headers.get('x-forwarded-for') || '';
    const ip = forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || '';
    const ua = request.headers.get('user-agent') || '';

    const attribution = {
      fbc: body.fbc || '',
      fbp: body.fbp || '',
      fbclid: body.fbclid || '',
      utm_source: body.utm_source || '',
      utm_medium: body.utm_medium || '',
      utm_campaign: body.utm_campaign || '',
      utm_content: body.utm_content || '',
      utm_term: body.utm_term || '',
      tz: body.tz || '',
      landing: 'womenabroad',
      landing_url: body.pageUrl || 'https://womenabroad.sayyes.school/',
      ip,
      ua
    };

    // Один и тот же id уходит с браузерным и серверным Lead — Мета склеит их в одно
    const leadEventId = body.leadEventId || crypto.randomUUID();
    const token = makeToken();

    await kvSet(`landing:${token}`, {
      attribution,
      leadEventId,
      createdAt: new Date().toISOString()
    }, TTL_SECONDS);

    // Lead этапа 1. Почты и телефона на лендинге нет, матчинг идёт по fbc/fbp и IP.
    let capi = null;
    try {
      capi = await sendCapiEvent({
        eventName: 'Lead',
        eventId: leadEventId,
        externalId: token,
        attribution,
        sourceUrl: attribution.landing_url,
        customData: {
          content_name: 'trial_booking',
          content_category: 'landing',
          value: 0,
          currency: 'EUR'
        }
      });
    } catch (e) {
      console.error('CAPI landing lead error:', e);
    }

    return NextResponse.json({
      ok: true,
      token,
      botLink: makeDeepLink(token),
      capi: capi && (capi.ok ? true : capi.skipped || capi.status || false)
    }, { headers });
  } catch (e) {
    console.error('Landing lead error:', e);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500, headers });
  }
}
