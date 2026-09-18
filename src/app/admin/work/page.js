import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { statusTags, whenLabel } from '@/lib/adminUi';
import { Shell } from '@/lib/adminShell';
import { loadBookings, slotStartMs, dayKey, today } from '@/lib/analytics';
import { getBookedSlots, kvGet } from '@/lib/redis';
import { needsMailResend } from '@/lib/adminActions';
import { getBlocked } from '@/lib/schedule';

// Та же сетка, что в карточке ученика: 10:00–20:00 через полчаса.
const GRID = [];

for (let h = 10; h <= 20; h++) {
  GRID.push(String(h).padStart(2, '0') + ':00');
  if (h < 20) GRID.push(String(h).padStart(2, '0') + ':30');
}

export const dynamic = 'force-dynamic';

const DAY = 86400000;
// Ошибка почты живёт в базе неделю, но для экрана интересны только свежие:
// починили провайдера — плашка должна уйти сама, а не висеть напоминанием.
const MAIL_FAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

async function mailTrouble() {
  try {
    const raw = await kvGet('last_mail_error');
    const info = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (!info || !info.at) return null;

    const at = new Date(info.at).getTime();

    if (!at || Date.now() - at > MAIL_FAIL_WINDOW_MS) return null;

    const text = String(info.text || info.error || '');
    const match = text.match(/"message"\s*:\s*"([^"]+)"/);

    return {
      reason: (match ? match[1] : text).slice(0, 160) || ('ответ ' + (info.status || '—')),
      when: new Date(at).toLocaleString('ru-RU', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow'
      })
    };
  } catch (e) {
    console.error('Mail health error:', e);

    return null;
  }
}

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

  // Цифры из «Что требует внимания» кликабельны и приводят сюда с фильтром:
  // видеть счётчик и не иметь возможности посмотреть, кто за ним стоит, —
  // полдела. Определения совпадают с health в analytics.js: если правится там,
  // править и здесь, иначе число и список разойдутся.
  const FILTERS = {
    'no-contact': {
      title: 'Вообще без контактов',
      empty: 'У всех есть хотя бы один способ связи.',
      test: booking => !booking.email && !booking.telegram && !booking.phone
    },
    'no-chat': {
      title: 'Без чата с ботом',
      empty: 'Все открыли бота.',
      test: booking => !booking.chatId
    },
    'no-email': {
      title: 'Без почты',
      empty: 'Почта есть у всех.',
      test: booking => !booking.email
    },
    'revive': {
      title: 'В очереди реанимации',
      empty: 'Очередь пуста.',
      test: booking => booking.attended === false && !booking.reviveStopped && (booking.reviveStep || 0) < 3
    },
    'unmarked-old': {
      title: 'Уроки без отметки старше суток',
      empty: 'Таких уроков нет.',
      test: booking => {
        const start = slotStartMs(booking);

        return start && start < Date.now() - 86400000 && booking.status !== 'cancelled'
          && (booking.attended === undefined || booking.attended === null);
      }
    },
    'pending': {
      title: 'Заявки без выбранного времени',
      empty: 'Все заявки со временем.',
      test: booking => (!booking.slot || booking.slot === 'no_time') && booking.status !== 'cancelled'
    }
  };

  const filterKey = FILTERS[String(params?.filter || '')] ? String(params.filter) : '';
  const filtered = filterKey ? all.filter(FILTERS[filterKey].test) : [];


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
  // Письма, которые не ушли: результат отправки пишется в заявку при записи,
  // поэтому список точный. Только будущие живые уроки — по прошедшему письмо
  // «вы записаны» уже не помощь, а путаница.
  const mailFailed = active.filter(booking => needsMailResend(booking, now));
  const todo = unmarked.length + noLink.length + waitingPay.length + noTime.length + mailFailed.length;

  const todays = byDay[todayKey] || [];
  const week = active
    .filter(booking => {
      const start = slotStartMs(booking);

      return start && start > now && start < now + 7 * DAY && dayKey(start) !== todayKey;
    })
    .sort((a, b) => slotStartMs(a) - slotStartMs(b));

  const found = query ? all.filter(booking => matches(booking, query)).slice(0, 40) : [];
  const link = (day, m) => '/admin/work?month=' + (m || month) + '&day=' + day;

  // Почта ломается молча: письма просто перестают уходить, а узнаём мы об этом
  // от клиента через день. Последняя ошибка лежит в базе — показываем её здесь,
  // на экране, который менеджер открывает каждый день. Один запрос в базу.
  const mailFail = await mailTrouble();

  return (
    <Shell session={session} active="work" title="Управление">
      {message && <div className={'msg' + (message.startsWith('Ошибка') ? ' err' : '')}>{message}</div>}

      {mailFail && (
        <div className="msg err">
          <b>Почта не отправляется.</b> {mailFail.reason}
          {' '}Последняя ошибка: {mailFail.when}. Не уходят подтверждения, напоминания
          и спецпредложения — пока не починим, полагайтесь только на Telegram.
        </div>
      )}

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
            <form method="post" action="/api/admin/action">
              <input type="hidden" name="back" value={'/admin/work?month=' + month + '&day=' + selected} />

              <div className="slots">
                {GRID.map(time => {
                  const key = selected + '_' + time;
                  const isBlocked = blocked.includes(key);
                  const isBusy = booked.includes(key) && !isBlocked;
                  const lesson = (byDay[selected] || []).find(item => item.slot === key);

                  if (isBusy || lesson) {
                    return (
                      <a className="slot off" key={key} href={lesson ? '/admin/client/' + lesson.id : undefined}>
                        {time}
                      </a>
                    );
                  }

                  // Галочка вместо кнопки: отметить можно сколько угодно времён,
                  // страница при этом не перезагружается. Раньше каждый слот был
                  // отдельной формой, и после клика экран прыгал обратно наверх.
                  return (
                    <label className={'slot' + (isBlocked ? ' mine' : '')} key={key}>
                      <input type="checkbox" name="slot" value={key} />
                      {time}{isBlocked ? ' ✕' : ''}
                    </label>
                  );
                })}
              </div>

              <div className="btns">
                <button type="submit" name="action" value="slot-close">Закрыть отмеченные</button>
                <button type="submit" name="action" value="slot-open">Открыть отмеченные</button>
              </div>
            </form>

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
              Отметьте нужные времена и нажмите «Закрыть отмеченные» — можно сразу несколько.
              Крестик значит, что слот уже закрыт вручную; отметьте его и нажмите «Открыть отмеченные».
              Серые без крестика — уроки, их сначала нужно перенести.
            </p>

            <div className="field" style={{ marginTop: 14 }}>
              <label>Часы работы на день недели — действует на все будущие такие дни</label>
            </div>
            <form method="post" action="/api/admin/action" className="btns">
              <input type="hidden" name="action" value="week-hours" />
              <input type="hidden" name="back" value={'/admin/work?month=' + month + '&day=' + selected} />
              <select name="dow" defaultValue={String(new Date(selected + 'T00:00:00').getDay())}>
                {['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'].map((name, index) => (
                  <option value={String(index)} key={name}>{name}</option>
                ))}
              </select>
              <select name="from" defaultValue="10:00">
                {GRID.map(time => <option value={time} key={time}>{time}</option>)}
              </select>
              <select name="to" defaultValue="20:30">
                {GRID.concat(['20:30']).map(time => <option value={time} key={time}>{time}</option>)}
              </select>
              <button type="submit">Применить</button>
            </form>
            <p className="muted">
              Всё, что вне интервала, закроется на восемь недель вперёд; внутри —
              откроется, кроме занятых уроками. Чтобы снять правило, поставьте одинаковые время начала и конца.
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

      {filterKey && (
        <div className="card">
          <h2>{FILTERS[filterKey].title}: {filtered.length}</h2>
          <List items={filtered.slice(0, 100)} empty={FILTERS[filterKey].empty} />
          {filtered.length > 100 && <p className="muted">Показаны первые 100.</p>}
          <p className="muted"><a href="/admin/work">Убрать фильтр</a></p>
        </div>
      )}

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
          {mailFailed.length > 0 && (
            <details className="sub" open>
              <summary>
                Письма, которые не ушли <span className="count">{mailFailed.length}</span>
              </summary>
              <p className="muted">
                Подтверждение записи не дошло: почта в момент записи не работала.
                Человек мог не узнать ни времени урока, ни ссылки на Zoom —
                особенно если его нет в боте. Отправка заодно вернёт просьбу
                подтвердить: крон дошлёт её за сутки и за 12 часов до урока.
              </p>
              <List items={mailFailed} empty="" />
              <form method="post" action="/api/admin/action" style={{ marginTop: 10 }}>
                <input type="hidden" name="action" value="resend-mail-all" />
                <input type="hidden" name="back" value="/admin/work" />
                <button className="primary" type="submit">
                  Отправить всем ({mailFailed.length})
                </button>
              </form>
            </details>
          )}

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
