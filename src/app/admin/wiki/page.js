import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { ADMIN_CSS, SECTIONS } from '@/lib/adminUi';
import { listPages } from '@/lib/wiki';

export const dynamic = 'force-dynamic';

export default async function WikiIndex({ searchParams }) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');

  const params = await searchParams;
  const message = params?.msg ? String(params.msg) : null;
  const pages = await listPages();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_CSS }} />
      <div className="wrap">
        <div className="top">
          <h1>База знаний</h1>
          <div className="who">@{session.username}</div>
        </div>

        <div className="nav">
          {SECTIONS.map(item => (
            <a key={item.key} className={item.key === 'wiki' ? 'on' : ''} href={item.href}>{item.label}</a>
          ))}
        </div>

        {message && <div className={'msg' + (message.startsWith('Ошибка') ? ' err' : '')}>{message}</div>}

        <div className="card">
          <h2>Страницы — {pages.length}</h2>
          {pages.map(page => (
            <div className="row" key={page.slug}>
              <div>
                <div className="name"><a href={'/admin/wiki/' + page.slug}>{page.title}</a></div>
                <div className="sub">
                  {page.updatedBy ? 'правил ' + page.updatedBy : 'без автора'}
                  {page.updatedAt ? ' · ' + new Date(page.updatedAt).toLocaleDateString('ru-RU') : ''}
                </div>
              </div>
            </div>
          ))}
          {pages.length === 0 && (
            <p className="muted">
              Страниц пока нет. Создайте первую ниже — например, «Как отмечать уроки».
            </p>
          )}
        </div>

        <div className="card">
          <h2>Новая страница</h2>
          <form method="post" action="/api/admin/wiki">
            <input type="hidden" name="action" value="save" />
            <div className="field">
              <label>Название</label>
              <input type="text" name="title" placeholder="Как отмечать уроки" />
            </div>
            <div className="field">
              <label>Текст. Заголовки — решётками, списки — дефисом, жирный — две звёздочки</label>
              <textarea name="body" placeholder="## Зачем это нужно..." />
            </div>
            <button className="primary" type="submit">Создать</button>
          </form>
        </div>
      </div>
    </>
  );
}
