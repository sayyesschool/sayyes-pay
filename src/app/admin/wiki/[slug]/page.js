import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { Shell } from '@/lib/adminShell';
import { getPage, renderMarkdown } from '@/lib/wiki';

export const dynamic = 'force-dynamic';

export default async function WikiPage({ params, searchParams }) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');

  const { slug } = await params;
  const query = await searchParams;
  const message = query?.msg ? String(query.msg) : null;
  const editing = query?.edit === '1';
  const page = await getPage(slug);

  if (!page) {
    return (
      <Shell session={session} active="wiki" title="Страница не найдена">
        <p>Такой страницы нет. <a href="/admin/wiki">К списку</a></p>
      </Shell>
    );
  }

  return (
    <Shell session={session} active="wiki" title={page.title}>
        {message && <div className={'msg' + (message.startsWith('Ошибка') ? ' err' : '')}>{message}</div>}

        {!editing && (
          <div className="card">
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body) }} />
            <div className="btns">
              <a className="btn" href={'/admin/wiki/' + page.slug + '?edit=1'}>Править</a>
              <a className="btn" href="/admin/wiki">К списку</a>
            </div>
            <p className="muted">
              {page.updatedBy ? 'Последним правил ' + page.updatedBy : ''}
              {page.updatedAt ? ' · ' + new Date(page.updatedAt).toLocaleString('ru-RU') : ''}
            </p>
          </div>
        )}

        {editing && (
          <div className="card">
            <form method="post" action="/api/admin/wiki">
              <input type="hidden" name="action" value="save" />
              <input type="hidden" name="slug" value={page.slug} />
              <div className="field">
                <label>Название</label>
                <input type="text" name="title" defaultValue={page.title} />
              </div>
              <div className="field">
                <label>Текст</label>
                <textarea name="body" defaultValue={page.body} style={{ minHeight: 320 }} />
              </div>
              <div className="field">
                <label>Порядок в списке (меньше — выше)</label>
                <input type="number" name="order" defaultValue={page.order || 100} />
              </div>
              <button className="primary" type="submit">Сохранить</button>
            </form>

            <form method="post" action="/api/admin/wiki" style={{ marginTop: 12 }}>
              <input type="hidden" name="action" value="delete" />
              <input type="hidden" name="slug" value={page.slug} />
              <button type="submit">Удалить страницу</button>
            </form>
          </div>
        )}
    </Shell>
  );
}
