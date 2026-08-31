import { NextResponse } from 'next/server';

import { kvGet } from '@/lib/redis';
import { mailProvider } from '@/lib/email';

// Письмо может не уйти молча: либо не задан ключ провайдера, либо провайдер
// ответил ошибкой, а её видно только в логах. Отдаём факт настройки
// и последнюю ошибку — никаких ключей и адресов.
export async function GET() {
  const provider = mailProvider();
  let lastError = null;

  try {
    const raw = await kvGet('last_mail_error');
    lastError = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    lastError = null;
  }

  return NextResponse.json({
    enabled: Boolean(provider),
    provider: provider || null,
    lastError
  });
}
