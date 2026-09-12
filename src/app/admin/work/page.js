import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { statusTags, whenLabel } from '@/lib/adminUi';
import { Shell } from '@/lib/adminShell';
import { loadBookings, slotStartMs, dayKey, today } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

const DAY = 86400000;

function matches(booking, query) {
  const q = query.trim().toLowerCase();

  if (!q) return false;

  return [booking.name, booking.email, booking.telegram, booking.phone, booking.id]
    .some(value => String(value || '').toLowerCase().includes(q));
}

function Row({ booking }) {
  return (
    <div className="row">
      <div>
        <div className="name">
          <a href={'/admin/client/' + booking.id}>{booking.name || 'Без имени'}</a>
        </div>
        <div className="sub">{booking.telegram || booking.email || booking.phone || 'контактов нет'}</div>
        <div style={{ marginTop: 4 }}>
          {statusTags(booking).map(([cls, label], i) => (
            <span key={i} className={'tag ' + cls}>{label}</span>
          ))}
        </div>
      </div>
      <div className="when">{whenLabel(booking)}</div>
    </div>
  );
}

export default async function WorkPage({ searchParams }) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');

  const params = await searchParams;
  const query = String(params?.q || '');
  const message = params?.msg ? String(params.msg) : null;
  const all = await loadBookings();
  const now = Date.now();
  const todayKey = today();

  const active = all.filter(booking => booking.status !== 'cancelled');
  const todays = active
    .filter(booking => {
      const start = slotStartMs(booking);

      return start && dayKey(start) === todayKey;
    })
    .sort((a, b) => slotStartMs(a) - slotStartMs(b));

  const week = active
    .filter(booking => {
      const start = slotStartMs(booking);

      return start && start > now && start < now + 7 * DAY && dayKey(start) !== todayKey;
    })
    .sort((a, b) => slotStartMs(a) - slotStartMs(b));

  // Долги: урок прошёл, отметки нет. Это первое, что должен видеть менеджер.
  const unmarked = active
    .filter(booking => {
      const start = slotStartMs(booking);

      return start && start < now && (booking.attended === undefined || booking.attended === null);
    })
    .sort((a, b) => slotStartMs(b) - slotStartMs(a));

  const pending = active.filter(booking => !booking.slot || booking.slot === 'no_time');
  const found = query ? all.filter(booking => matches(booking, query)).slice(0, 40) : [];

  return (
    <Shell session={session} active="work" title="Работа">
        {message && <div className={'msg' + (message.startsWith('Ошибка') ? ' err' : '')}>{message}</div>}

        <form className="card" method="get">
          <div className="field">
            <label>Поиск по имени, почте, телефону или коду записи</label>
            <input type="search" name="q" defaultValue={query} placeholder="например, Ирина или tfl1mrpg" />
          </div>
          <button className="primary" type="submit">Найти</button>
        </form>

        {query && (
          <div className="card">
            <h2>Найдено: {found.length}</h2>
            {found.map(booking => <Row key={booking.id} booking={booking} />)}
            {found.length === 0 && <p className="muted">Ничего не нашлось.</p>}
          </div>
        )}

        {unmarked.length > 0 && (
          <div className="card">
            <h2>Без отметки — {unmarked.length}</h2>
            <p className="muted">Урок прошёл, но никто не отметил, состоялся он или нет.</p>
            {unmarked.slice(0, 20).map(booking => <Row key={booking.id} booking={booking} />)}
          </div>
        )}

        <div className="card">
          <h2>Сегодня — {todays.length}</h2>
          {todays.map(booking => <Row key={booking.id} booking={booking} />)}
          {todays.length === 0 && <p className="muted">На сегодня уроков нет.</p>}
        </div>

        <div className="card">
          <h2>Ближайшая неделя — {week.length}</h2>
          {week.map(booking => <Row key={booking.id} booking={booking} />)}
          {week.length === 0 && <p className="muted">Записей на неделю пока нет.</p>}
        </div>

        {pending.length > 0 && (
          <div className="card">
            <h2>Без времени — {pending.length}</h2>
            <p className="muted">Человек оставил заявку, но не выбрал слот: с ним нужно связаться.</p>
            {pending.map(booking => <Row key={booking.id} booking={booking} />)}
          </div>
        )}
    </Shell>
  );
}
