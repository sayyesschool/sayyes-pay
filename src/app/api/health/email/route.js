import { NextResponse } from 'next/server';

import { mailProvider } from '@/lib/email';

// Письмо может не уйти молча: если ни один ключ провайдера не задан,
// модуль просто ничего не делает. Отдаём только факт настройки — никаких ключей.
export async function GET() {
  const provider = mailProvider();

  return NextResponse.json({
    enabled: Boolean(provider),
    provider: provider || null
  });
}
