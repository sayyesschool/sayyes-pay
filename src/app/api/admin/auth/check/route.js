import { NextResponse } from 'next/server';
import { kvGet, kvDel } from '@/lib/redis';
import { SESSION_COOKIE, signSession } from '@/lib/adminAuth';
import { rightsOf, has } from '@/lib/access';

export async function GET(request) {
  const nonce = new URL(request.url).searchParams.get('n');

  if (!nonce) return NextResponse.json({ ok: false });

  const record = await kvGet('adminlogin:' + nonce);

  if (!record) return NextResponse.json({ ok: false, error: 'expired' });
  if (!record.username) return NextResponse.json({ ok: false });

  const rights = await rightsOf(record.username);
  const role = has(rights, 'super') ? 'owner' : 'manager';

  // Код подтверждён из бота, но у аккаунта нет ни одного права - дальше не пускаем.
  if (!rights.length) {
    await kvDel('adminlogin:' + nonce);

    return NextResponse.json({ ok: false, error: 'no-access' });
  }

  await kvDel('adminlogin:' + nonce);

  const response = NextResponse.json({ ok: true, role });

  response.cookies.set(SESSION_COOKIE, signSession(record.username), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60
  });

  return response;
}
