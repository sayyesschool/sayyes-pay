import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { Shell } from '@/lib/adminShell';
import { listPages } from '@/lib/wiki';
import { syncSeed, staleSlugs } from '@/lib/wikiSeed';

export const dynamic = 'force-dynamic';

export default async function WikiIndex({ searchParams }) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');

  const params = await searchParams;
  const message = params?.msg ? String(params.msg) : null;
  // Текст страниц живёт и в коде. Если там его обновили, перезальём — кроме
  // страниц, которые правили руками: их пометим и дадим кнопку.
  await syncSeed();

  const pages = await listPages();
  const stale = await staleSlugs();

  return (
    <Shell session={session} active="wiki" title="База знаний">
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
                {stale.includes(page.slug) && (
                  <div className="sub">
                    <span className="tag wait">в коде есть новая версия</span>
                  </div>
                )}
              </div>
              {stale.includes(page.slug) && (
                <form method="post" action="/api/admin/wiki">
                  <input type="hidden" name="action" value="reseed" />
                  <input type="hidden" name="slug" value={page.slug} />
                  <div className="btns">
                    <button type="submit">Обновить из кода</button>
                  </div>
                </form>
              )}
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
    </Shell>
  );
}
