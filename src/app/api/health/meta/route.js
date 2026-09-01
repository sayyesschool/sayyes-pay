import { NextResponse } from 'next/server';

// Куда реально уходят события. Из-за того, что это было не видно снаружи,
// зеркало месяц смотрело в тот же датасет, и все цифры в кабинете двоились.
// Идентификаторы пикселей не секрет: они и так видны в браузере. Токены — нет.
export async function GET() {
  const primary = process.env.META_PIXEL_ID || '1405840230688968';
  const mirror = process.env.META_PIXEL_ID_2 || null;

  return NextResponse.json({
    primary,
    mirror,
    mirrorEnabled: Boolean(mirror && process.env.META_CAPI_TOKEN_2 && mirror !== primary),
    mirrorSameAsPrimary: Boolean(mirror && mirror === primary),
    capiConfigured: Boolean(process.env.META_CAPI_TOKEN)
  });
}
