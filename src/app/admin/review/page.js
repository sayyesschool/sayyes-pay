import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession, can } from '@/lib/adminAuth';
import { Shell } from '@/lib/adminShell';
import { buildReview, lastReview } from '@/lib/threadReview';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Разбор переписки менеджеров (19.11.2026). Только супер-админы: разбор идёт по именам.
function when(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString();

  return d.slice(8, 10) + '.' + d.slice(5, 7) + ' ' + d.slice(11, 16) + ' МСК';
}

export default async function ReviewPage({ searchParams }) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');
  if (!can(session, 'super')) redirect('/admin/work');

  const params = await searchParams;
  const days = [7, 14, 30].includes(Number(params?.days)) ? Number(params.days) : 14;
  const result = params?.run ? await buildReview(days) : await lastReview();
  const s = result && result.speed;

  return (
    <Shell session={session} active="access" title="Разбор переписки">
      <form className="card" method="get">
        <input type="hidden" name="run" value="1" />
        <div className="btns" style={{ alignItems: 'center' }}>
          <select name="days" defaultValue={String(days)}>
            <option value="7">7 дней</option>
            <option value="14">14 дней</option>
            <option value="30">30 дней</option>
          </select>
          <button className="primary" type="submit">Собрать разбор</button>
          <span className="muted">Занимает до минуты. Раз в неделю, в понедельник утром, разбор приходит вам в бот сам.</span>
        </div>
      </form>

      {result && !result.ok && <div className="msg err">{result.error}</div>}

      {result && result.ok && (
        <>
          <div className="card">
            <h2>Скорость ответа · {result.days} дней · {when(result.at)}</h2>
            <div className="kpis">
              <div className="kpi"><b>{s.questions}</b><span>сообщений ждали ответа</span></div>
              <div className="kpi"><b>{s.medianMin === null ? '—' : s.medianMin + ' мин'}</b><span>медиана ожидания</span></div>
              <div className="kpi"><b>{s.within30 === null ? '—' : s.within30 + '%'}</b><span>ответили за 30 мин</span></div>
              <div className="kpi"><b className={s.unanswered.length ? 'bad' : ''}>{s.unanswered.length}</b><span>без ответа больше 2 ч</span></div>
            </div>
            {s.byManager.length > 0 && (
              <table style={{ marginTop: 10 }}>
                <thead><tr><th>Менеджер</th><th>Ответов</th><th>Медиана</th><th>За 30 мин</th></tr></thead>
                <tbody>
                  {s.byManager.map(m => (
                    <tr key={m.who}><td>{m.who}</td><td>{m.replies}</td><td>{m.medianMin} мин</td><td>{m.within30}%</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {s.unanswered.length > 0 && (
              <>
                <h2 style={{ marginTop: 14 }}>Без ответа</h2>
                {s.unanswered.map(u => (
                  <div className="row" key={u.id + u.at}>
                    <a href={'/admin/client/' + u.id}>{u.name}</a> <span className="muted">· {u.at} · {u.text}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="card">
            <h2>Разбор · {result.dialogs} диалогов</h2>
            <div style={{ whiteSpace: 'pre-wrap' }}>{result.text}</div>
          </div>
        </>
      )}
    </Shell>
  );
}
