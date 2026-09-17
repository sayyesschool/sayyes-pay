import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { Shell } from '@/lib/adminShell';
import { listStripePayments } from '@/lib/stripePayments';

export const dynamic = 'force-dynamic';

// Касса Stripe целиком, а не только то, что дошло до нас вебхуком. Отдельной
// страницей, а не блоком на рабочем столе: список ходит в Stripe и перебирает
// все заявки, такое нельзя грузить при каждом открытии админки.

function fmt(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return String(value || '—');

  return date.toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow'
  });
}

export default async function StripePage({ searchParams }) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');
  if (session.role !== 'owner') redirect('/admin/work');

  const query = await searchParams;
  const message = query?.msg ? String(query.msg) : null;
  const days = Number(query?.days) || 30;
  const back = '/admin/stripe?days=' + days;

  let rows = [];
  let error = null;

  try {
    rows = await listStripePayments(days);
  } catch (e) {
    error = e.message;
  }

  const loose = rows.filter(row => !row.linked);
  const linked = rows.filter(row => row.linked);
  const sum = list => Math.round(list.reduce((acc, row) => acc + Number(row.amount || 0), 0) / 100);

  return (
    <Shell session={session} active="stripe" title="Оплаты Stripe">
      {message && <div className={'msg' + (message.startsWith('Ошибка') ? ' err' : '')}>{message}</div>}

      <div className="card">
        <div className="btns">
          {[7, 30, 90].map(value => (
            <a key={value} className={'tag' + (value === days ? ' ok' : '')} href={'/admin/stripe?days=' + value}>
              {value} дней
            </a>
          ))}
        </div>
        <p className="muted">
          Всё, что Stripe провёл за период: и оплаты по ссылке из бота, и счета, выставленные вручную.
          Привязка к заявке идёт по почте плательщика — если человек платил с другой почты, она не сработает.
        </p>
        {error && <p className="bad">Stripe не ответил: {error}</p>}
      </div>

      <div className="card">
        <h2>Без заявки · {loose.length} на {sum(loose)} EUR</h2>
        {loose.length === 0 && <p className="muted">Все оплаты разнесены по заявкам.</p>}
        {loose.map(row => (
          <div className="row" key={row.id}>
            <div>
              <div className="name">{Math.round(row.amount / 100)} {row.currency} · {row.label}</div>
              <div className="sub">
                {fmt(row.at)} · {row.email || 'почты нет'} {row.invoice ? '· по счёту' : ''}
              </div>
              <div className="sub"><code>{row.id}</code></div>
              {row.guessId && (
                <div className="sub">Похоже на заявку {row.guessName} · <code>{row.guessId}</code></div>
              )}
            </div>
            <form method="post" action="/api/admin/action">
              <input type="hidden" name="action" value="attach-pi" />
              <input type="hidden" name="pi" value={row.id} />
              <input type="hidden" name="back" value={back} />
              <input type="text" name="id" placeholder="код заявки" defaultValue={row.guessId} />
              <div className="btns">
                <button className="primary" type="submit">Привязать</button>
              </div>
            </form>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Привязанные · {linked.length} на {sum(linked)} EUR</h2>
        {linked.length === 0 && <p className="muted">Пока ничего.</p>}
        {linked.map(row => (
          <div className="row" key={row.id}>
            <div>
              <div className="name">{Math.round(row.amount / 100)} {row.currency} · {row.label}</div>
              <div className="sub">{fmt(row.at)} · {row.email || 'почты нет'}</div>
            </div>
            <div className="when">
              {row.bookingId
                ? <a href={'/admin/client/' + row.bookingId}>{row.bookingId}</a>
                : 'заявка не указана'}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
