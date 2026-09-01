import { NextResponse } from 'next/server';

import { kvGet } from '@/lib/redis';

// Куда реально уходят события и чем закончилась последняя отправка каждого.
// Из-за того, что этого не было видно снаружи, зеркало месяц смотрело в тот же
// датасет, а StartTrial молча не доходил вообще.
// Идентификаторы пикселей не секрет: они и так видны в браузере. Токены — нет.
const EVENTS = ['Lead', 'Schedule', 'SubmitApplication', 'StartTrial', 'Purchase'];

export async function GET() {
  const primary = process.env.META_PIXEL_ID || '1405840230688968';
  const mirror = process.env.META_PIXEL_ID_2 || null;
  const last = {};

  for (const name of EVENTS) {
    try {
      last[name] = (await kvGet('last_capi:' + name)) || null;
    } catch (e) {
      last[name] = { error: e.message };
    }
  }

  return NextResponse.json({
    primary,
    mirror,
    mirrorEnabled: Boolean(mirror && process.env.META_CAPI_TOKEN_2 && mirror !== primary),
    mirrorSameAsPrimary: Boolean(mirror && mirror === primary),
    capiConfigured: Boolean(process.env.META_CAPI_TOKEN),
    lastSend: last
  });
}
