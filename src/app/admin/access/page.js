import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession, can } from '@/lib/adminAuth';
import { Shell } from '@/lib/adminShell';
import { RIGHTS, RIGHT_LABEL, SUPER_USERNAMES, getUsers, getAccessLog, getProfiles } from '@/lib/access';
import { TRIAL_HOST_USERNAMES } from '@/lib/managers';
import { kvGet } from '@/lib/redis';

export const dynamic = 'force-dynamic';

// «Доступы» (макет согласован Димой 31.10.2026): кто входит в админку и бот и с какими правами.
// Супер-админы из настроек сервера показаны, но не редактируются.

const CSS = [
  '.syad .acc{width:100%;border-collapse:collapse}',
  '.syad .acc th,.syad .acc td{border-bottom:1px solid #f1f1f4;padding:8px 6px;text-align:center;font-size:14px}',
  '.syad .acc th{color:#71717a;font-weight:500;font-size:12px}',
  '.syad .acc th:first-child,.syad .acc td:first-child{text-align:left}',
  '.syad .acc input[type=checkbox]{width:18px;height:18px}',
  '.syad .acc input[type=text],.syad .acc input[type=email]{width:130px;padding:6px 8px;font-size:13px}',
  '.syad .sa{background:#f3e8ff;color:#5b21b6;font-size:12px;padding:2px 8px;border-radius:999px}',
  '.syad .addrow{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
  '.syad .addrow label{display:inline-flex;gap:6px;align-items:center;font-size:14px}'
].join('\n');

function fmt(value) {
  if (!value) return '';

  return new Date(value).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow'
  });
}

async function botStatus(name) {
  const id = (await kvGet('manager_chat:' + name)) || (await kvGet('user_chat:' + name));

  return Boolean(id);
}

export default async function AccessPage({ searchParams }) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');
  if (!can(session, 'super')) redirect('/admin/work');

  const params = await searchParams;
  const message = params?.msg ? String(params.msg) : null;
  const users = await getUsers();
  const names = Object.keys(users).sort();
  const log = await getAccessLog(15);
  const prof = Object.fromEntries((await getProfiles()).map(p => [p.username, p]));
  const bot = {};

  for (const name of [...SUPER_USERNAMES, ...names]) bot[name] = await botStatus(name);

  const note = name => [
    TRIAL_HOST_USERNAMES.includes(name) ? 'ведёт уроки' : '',
    bot[name] ? 'бот ✓' : 'бот не запущен'
  ].filter(Boolean).join(' · ');

  const profileCells = name => (
    <>
      <td>
        <input type="hidden" name="profile" value={name} />
        <input type="text" name={name + '__name'} defaultValue={(prof[name] && prof[name].name) || ''} placeholder="Кристина" aria-label={'Имя для клиентов @' + name} />
      </td>
    </>
  );

  return (
    <Shell session={session} active="access" title="Доступы">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {message && <div className={'msg' + (message.startsWith('Ошибка') ? ' err' : '')}>{message}</div>}

      <div className="card">
        <h2>Кто входит в админку и бот</h2>
        <form method="post" action="/api/admin/action">
          <input type="hidden" name="back" value="/admin/access" />
          <div className="scroll">
            <table className="acc">
              <thead>
                <tr>
                  <th>Telegram</th>
                  {RIGHTS.map(r => <th key={r}>{RIGHT_LABEL[r]}</th>)}
                  <th>Имя для клиентов</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {SUPER_USERNAMES.map(name => (
                  <tr key={name}>
                    <td>@{name}<div className="muted">из настроек сервера · {note(name)}</div></td>
                    <td>✓</td><td>✓</td><td>✓</td>
                    <td><span className="sa">супер-админ</span></td>
                    {profileCells(name)}
                    <td className="muted">нельзя снять</td>
                  </tr>
                ))}
                {names.map(name => (
                  <tr key={name}>
                    <td>
                      @{name}
                      <input type="hidden" name="user" value={name} />
                      <div className="muted">{note(name)}</div>
                    </td>
                    {RIGHTS.map(r => (
                      <td key={r}>
                        <input
                          type="checkbox"
                          name={name + '__' + r}
                          value="1"
                          defaultChecked={(users[name].rights || []).includes(r)}
                          aria-label={RIGHT_LABEL[r] + ' для @' + name}
                        />
                      </td>
                    ))}
                    {profileCells(name)}
                    <td>
                      {name !== session.username && (
                        <button type="submit" name="action" value={'access-del:' + name}>Удалить</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btns" style={{ marginTop: 12 }}>
            <button type="submit" name="action" value="access-save">Сохранить</button>
          </div>
          <p className="muted">
            «Имя для клиентов» подписывает сообщения оффера после пробного («Это Кристина из Say Yes!») и стоит
            в строке «От кого» писем («Кристина | Say Yes!»). Без имени сотрудника нельзя выбрать при запуске оффера.
            Ответы на письма приходят в общий ящик info@ и появляются в карточке ученика.
          </p>
        </form>
      </div>

      <div className="card">
        <h2>Добавить человека</h2>
        <form method="post" action="/api/admin/action">
          <input type="hidden" name="action" value="access-add" />
          <input type="hidden" name="back" value="/admin/access" />
          <div className="addrow">
            <input type="text" name="username" placeholder="@username в Telegram" required style={{ width: 220 }} />
            {RIGHTS.map(r => (
              <label key={r}>
                <input type="checkbox" name={'r_' + r} value="1" defaultChecked={r === 'base'} /> {RIGHT_LABEL[r]}
              </label>
            ))}
            <button type="submit">Добавить</button>
          </div>
        </form>
        <p className="muted" style={{ marginTop: 10 }}>
          Вход по коду из бота, как сейчас. Чтобы бот мог писать человеку, ему нужно один раз нажать
          «Начать» в @SY_school_bot. Каждое изменение прав пишется в журнал и уходит уведомлением супер-админам.
        </p>
      </div>

      <div className="card">
        <h2>Журнал</h2>
        {log.length === 0 ? (
          <p className="muted">Изменений пока не было.</p>
        ) : (
          <table className="acc">
            <tbody>
              {log.map((e, i) => (
                <tr key={i}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmt(e.at)}</td>
                  <td>{e.by}</td>
                  <td style={{ textAlign: 'left' }}>{e.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="muted" style={{ marginTop: 8 }}>
          Права: «Базовый» - управление заявками и уроками, ссылки и проведение оплат, база знаний, уведомления в боте.
          «Финансы» - аналитика с оплатами и рекламой, страница «Оплаты». «Расписание» - открыть и закрыть слоты,
          часы недели. «Супер-админ» - всё, плюс «Объявления» и «Доступы».
        </div>
      </div>
    </Shell>
  );
}
