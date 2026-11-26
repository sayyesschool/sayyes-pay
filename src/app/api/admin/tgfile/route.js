import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { getThread } from '@/lib/thread';
import { fileDownloadUrl } from '@/lib/telegram';

// Открыть файл, отправленный ученику в бот (26.11.2026). Сам файл мы не храним:
// берём его с серверов Telegram по file_id из переписки. Ссылку Telegram наружу не отдаём,
// в ней токен бота. Только для вошедших в админку.
export async function GET(request) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) return NextResponse.redirect(new URL('/admin/login', request.url), 303);

  const b = request.nextUrl.searchParams.get('b') || '';
  const itemId = request.nextUrl.searchParams.get('item') || '';
  const item = (await getThread(b)).find(x => x && x.id === itemId);

  if (!item || !item.file || !item.file.fileId) return new NextResponse('Файл не найден', { status: 404 });

  const url = await fileDownloadUrl(item.file.fileId);

  if (!url) return new NextResponse('Telegram не отдал файл', { status: 502 });

  const resp = await fetch(url);

  if (!resp.ok || !resp.body) return new NextResponse('Telegram не отдал файл', { status: 502 });

  const name = encodeURIComponent(item.file.name || 'file');

  return new NextResponse(resp.body, {
    headers: {
      'Content-Type': item.file.type || 'application/octet-stream',
      'Content-Disposition': "inline; filename*=UTF-8''" + name,
      'Cache-Control': 'private, no-store'
    }
  });
}
