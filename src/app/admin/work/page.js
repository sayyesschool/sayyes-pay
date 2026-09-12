import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { statusTags, whenLabel } from '@/lib/adminUi';
import { Shell } from '@/lib/adminShell';
import { loadBookings, slotStartMs, dayKey, today } from '@/lib/analytics';
import { getBookedSlots } from '@/lib/redis';
import { getBlocked } from '@/lib/schedule';
import { isSlotClosed } from '@/lib/capacity';

// Та же сетка, что в карточке ученика: 10:00–20:00 через полчаса.
const GRID = [];

for (let h = 10; h <= 20; h++) {
  GRID.push(String(h).padStart(2, '0') + ':00');
  if (h < 20) GRID.push(String(h).padStart(2, '0') + ':30');
}

export const dynamic = 'force-dynamic';

const DAY = 86400000;
const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function matches(booking, query) {
  const q = query.trim().toLowerCase();

  if (!q) return false;

  return [booking.name, booking.email, booking.telegram, booking.phone, booking.id]
    .some(value => String(value || '').toLowerCase().includes(q));
}

function Row({ booking, time }) {
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
      <div className="when">{time || whenLabel(booking)}</div>
    </div>
  );
}

function List({ items, empty }) {
  if (!items.length) return <p className="muted">{empty}</p>;

  return items.map(booking => <Row key={booking.id} booking={booking} />);
}

export default async function ManagePage({ searchParams }) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');

  const params = await searchParams;
  const query = String(params?.q || '');
  const message = params?.msg ? String(params.msg) : null;
  const todayKey = today();
  const month = /^\d{4}-\d{2}$/.test(String(params?.month || '')) ? params.month : todayKey.slice(0, 7);
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(String(params?.day || '')) ? params.day : todayKey;

  const owner = session.role === 'owner';
  const all = await loadBookings();
  const booked = owner ? await getBookedSlots() : [];
  const blocked = owner ? await getBlocked() : [];
  const active = all.filter(booking => booking.status !== 'cancelled');
  const now = Date.now();

  // Раскладываем записи по дням один раз: дальше и календарь, и списки берут отсюда.
  const byDay = {};

  for (const booking of active) {
    const start = slotStartMs(booking);

    if (!start) continue;

    const key = dayKey(start);

    (byDay[key] || (byDay[key] = [])).push(booking);
  }

  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => slotStartMs(a) - slotStartMs(b));
  }

  // --- календарь месяца ---
  const [year, mon] = month.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, mon - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const shift = (firstDay.getUTCDay() + 6) % 7;
  const prev = new Date(Date.UTC(year, mon - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 7);
  const cells = [];

  for (let i = 0; i < shift; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(month + '-' + String(d).padStart(2, '0'));
  }

  const dayItems = byDay[selected] || [];

  // --- что требует действий ---
  const unmarked = active.filter(booking => {
    const start = slotStartMs(booking);

    return start && start < now && (booking.attended === undefined || booking.attended === null);
  }).sort((a, b) => slotStartMs(b) - slotStartMs(a));

  const noLink = active.filter(booking => booking.attended === true && !booking.paid && !booking.payLinkSentAt);
  const waitingPay = active.filter(booking => booking.attended === true && !booking.paid && booking.payLinkSentAt);
  const noTime = active.filter(booking => !booking.slot || booking.slot === 'no_time');
  const todo = unmarked.length + noLink.length + waitingPay.length + noTime.length;

  const todays = byDay[todayKey] || [];
  const week = active
    .filter(booking => {
      const start = slotStartMs(booking);

      return start && start > now && start < now + 7 * DAY && dayKey(start) !== todayKey;
    })
    .sort((a, b) => slotStartMs(a) - slotStartMs(b));

  const found = query ? all.filter(booking => matches(booking, query)).slice(0, 40) : [];
  const link = (day, m) => '/admin/work?month=' + (m || month) + '&day=' + day;

  return (
    <Shell session={session} active="work" title="Управление">
      {message && <div className={'msg' + (message.startsWith('Ошибка') ? ' err' : '')}>{message}</div>}

      <div className="card">
        <div className="calhead">
          <a href={'/admin/work?month=' + prev + '&day=' + selected}>←</a>
          <b>{MONTHS[mon - 1]} {year}</b>
          <a href={'/admin/work?month=' + next + '&day=' + selected}>→</a>
        </div>

        <div className="cal">
          {DOW.map(name => <div className="dow" key={name}>{name}</div>)}
          {cells.map((day, index) => {
            if (!day) return <span className="day empty" key={'e' + index} />;

            const count = (byDay[day] || []).length;
            const classes = ['day'];

            if (count) classes.push('has');
            if (day === todayKey) classes.push('today');
            if (day === selected) classes.push('on');

            return (
              <a className={classes.join(' ')} href={link(day)} key={day}>
                <span className="n">{Number(day.slice(8))}</span>
                {count ? <span className="c">{count} урок{count > 1 ? 'а' : ''}</span> : null}
              </a>
            );
          })}
        </div>

        <div className="sub-h">
          Расписание на {selected.slice(8)}.{selected.slice(5, 7)}
          {selected === todayKey ? ' — сегодня' : ''}
        </div>
        <List
          items={dayItems.map(booking => booking)}
          empty="В этот день уроков нет."
        />
      </div>

      {owner && (
        <details className="block">
          <summary>
            <span>Расписание: открыть и закрыть слоты</span>
            <span className="count">{selected.slice(8)}.{selected.slice(5, 7)}</span>
          </summary>
          <div className="body">
            <p className="muted">
              Закрытый слот исчезает из воронки и из бота сразу — его нельзя выбрать нигде.
              Слот с уроком закрыть нельзя: сначала перенесите запись.
            </p>
            <div className="slots">
              {GRID.map(time => {
                const key = selected + '_' + time;
                const isBlocked = blocked.includes(key);
                const isBusy = booked.includes(key) && !isBlocked;
                const isClosed = isSlotClosed(key);
                const lesson = (byDay[selected] || []).find(item => item.slot === key);

                if (isBusy || lesson) {
                  return (
                    <a className="slot off" key={key} href={lesson ? '/admin/client/' + lesson.id : undefined}>
                      {time}
                    </a>
                  );
                }

                if (isClosed) return <span className="slot off" key={key}>{time}</span>;

                return (
                  <form method="post" action="/api/admin/action" key={key}>
                    <input type="hidden" name="action" value={isBlocked ? 'slot-open' : 'slot-close'} />
                    <input type="hidden" name="slot" value={key} />
                    <input type="hidden" name="back" value={'/admin/work?month=' + month + '&day=' + selected} />
                    <button className={'slot' + (isBlocked ? ' mine' : '')} type="submit">
                      {time}{isBlocked ? ' ✕' : ''}
                    </button>
                  </form>
                );
              })}
            </div>

            <div className="btns">
              <form method="post" action="/api/admin/action">
                <input type="hidden" name="action" value="slot-close" />
                <input type="hidden" name="back" value={'/admin/work?month=' + month + '&day=' + selected} />
                {GRID.map(time => (
                  <input type="hidden" name="slot" value={selected + '_' + time} key={time} />
                ))}
                <button type="submit">Закрыть весь день</button>
              </form>

              <form method="post" action="/api/admin/action">
                <input type="hidden" name="action" value="slot-open" />
                <input type="hidden" name="back" value={'/admin/work?month=' + month + '&day=' + selected} />
                {GRID.map(time => (
                  <input type="hidden" name="slot" value={selected + '_' + time} key={time} />
                ))}
                <button type="submit">Открыть весь день</button>
              </form>
            </div>

            <p className="muted">
              Крестиком помечены слоты, закрытые вручную, — нажатие открывает их обратно.
              Серые без крестика — уроки и дни с ограничениями из расписания школы.
            </p>
          </div>
        </details>
      )}

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
          <List items={found} empty="Ничего не нашлось." />
        </div>
      )}

      <details className="block" open={todo > 0}>
        <summary>
          <span>Требуют действий</span>
          <span className="count">{todo}</span>
        </summary>
        <div className="body">
          <details className="sub">
            <summary>Уроки без отметки <span className="count">{unmarked.length}</span></summary>
            <List items={unmarked.slice(0, 40)} empty="Все уроки отмечены." />
            {unmarked.length > 0 && (
              <form method="post" action="/api/admin/action" style={{ marginTop: 10 }}>
                <input type="hidden" name="action" value="archive-unmarked" />
                <input type="hidden" name="days" value="30" />
                <input type="hidden" name="back" value="/admin/work" />
                <button type="submit">Убрать в архив всё старше 30 дней</button>
                <p className="muted">
                  Записи пропадут из списков и отчётов, но останутся в поиске.
                  Ученикам и в чат бота ничего не уходит. Вернуть: команда /cleanup undo.
                </p>
              </form>
            )}
          </details>

          <details className="sub">
            <summary>Пришли, но ссылка на оплату не отправлена <span className="count">{noLink.length}</span></summary>
            <List items={noLink} empty="Таких нет." />
          </details>

          <details className="sub">
            <summary>Ссылка отправлена, оплаты пока нет <span className="count">{waitingPay.length}</span></summary>
            <List items={waitingPay} empty="Таких нет." />
          </details>

          <details className="sub">
            <summary>Заявки без выбранного времени <span className="count">{noTime.length}</span></summary>
            <List items={noTime} empty="Таких нет." />
          </details>
        </div>
      </details>

      <details className="block">
        <summary>
          <span>Записи на сегодня</span>
          <span className="count">{todays.length}</span>
        </summary>
        <div className="body">
          <List items={todays} empty="На сегодня уроков нет." />
        </div>
      </details>

      <details className="block">
        <summary>
          <span>Записи на ближайшие 7 дней</span>
          <span className="count">{week.length}</span>
        </summary>
        <div className="body">
          <List items={week} empty="Записей на неделю пока нет." />
        </div>
      </details>
    </Shell>
  );
}
