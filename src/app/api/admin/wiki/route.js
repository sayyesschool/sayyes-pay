import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { savePage, deletePage, slugify } from '@/lib/wiki';

export async function POST(request) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) return NextResponse.redirect(new URL('/admin/login', request.url), 303);

  const form = await request.formData();
  const action = String(form.get('action') || 'save');
  const slug = String(form.get('slug') || '');
  const title = String(form.get('title') || '').trim();
  const body = String(form.get('body') || '');

  if (action === 'delete' && slug) {
    await deletePage(slug);

    return NextResponse.redirect(new URL('/admin/wiki?msg=Страница удалена', request.url), 303);
  }

  if (!title) {
    return NextResponse.redirect(new URL('/admin/wiki?msg=Ошибка: у страницы должно быть название', request.url), 303);
  }

  const page = await savePage({
    slug: slug || slugify(title),
    title,
    body,
    by: session.username,
    order: Number(form.get('order')) || undefined
  });

  return NextResponse.redirect(new URL('/admin/wiki/' + page.slug + '?msg=Сохранено', request.url), 303);
}
