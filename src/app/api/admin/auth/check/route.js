import { NextResponse } from 'next/server';
import { kvGet, kvDel } from '@/lib/redis';
import { SESSION_COOKIE, roleOf, signSession } from '@/lib/adminAuth';

export async function GET(request) {
  const nonce = new URL(request.url).searchParams.get('n');

  if (!nonce) return NextResponse.json({ ok: false });

  const record = await kvGet('adminlogin:' + nonce);

  if (!record) return NextResponse.json({ ok: false, error: 'expired' });
  if (!record.username) return NextResponse.json({ ok: false });

  const role = roleOf(record.username);

  // Код подтверждён из бота, но аккаунт не менеджер — дальше не пускаем.
  if (!role) {
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
