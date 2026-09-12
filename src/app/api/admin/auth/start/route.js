import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { kvSet } from '@/lib/redis';
import { BOT_USERNAME } from '@/lib/telegram';

// Одноразовый код на 10 минут. Пока бот его не подтвердит, он бесполезен:
// сам по себе код никого никуда не пускает.
export async function GET() {
  const nonce = crypto.randomBytes(6).toString('hex');

  await kvSet('adminlogin:' + nonce, { at: Date.now() }, 600);

  return NextResponse.json({
    nonce,
    link: 'https://t.me/' + BOT_USERNAME + '?start=adm_' + nonce
  });
}
