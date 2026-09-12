import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { ADMIN_CSS, SECTIONS, statusTags } from '@/lib/adminUi';
import { getBooking } from '@/lib/redis';
import { listPacks } from '@/lib/adminActions';
import { introActive, introExpiry } from '@/services/intro';

export const dynamic = 'force-dynamic';

function fmt(value) {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow'
  });
}

export default async function ClientPage({ params, searchParams }) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');

  const { id } = await params;
  const query = await searchParams;
  const message = query?.msg ? String(query.msg) : null;
  const booking = await getBooking(id);

  if (!booking) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: ADMIN_CSS }} />
        <div className="wrap">
          <p>Записи с кодом {id} нет. <a href="/admin/work">Вернуться к работе</a></p>
        </div>
      </>
    );
  }

  const back = '/admin/client/' + id;
  const packs = await listPacks(booking);
  const answers = booking.quizAnswers || {};
  const offerUntil = introExpiry(booking);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_CSS }} />
      <div className="wrap">
        <div className="top">
          <h1>{booking.name || 'Без имени'}</h1>
          <div className="who">@{session.username}</div>
        </div>

        <div className="nav">
          {SECTIONS.map(item => (
            <a key={item.key} className={item.key === 'work' ? 'on' : ''} href={item.href}>{item.label}</a>
          ))}
        </div>

        {message && <div className={'msg' + (message.startsWith('Ошибка') ? ' err' : '')}>{message}</div>}

        <div className="card">
          <div style={{ marginBottom: 8 }}>
            {statusTags(booking).map(([cls, label], i) => <span key={i} className={'tag ' + cls}>{label}</span>)}
          </div>
          <div className="kv">
            <div><b>Код</b> {booking.id}</div>
            <div><b>Урок</b> {booking.slotDate || '—'} {booking.slotMsk || ''} (МСК)</div>
            <div><b>Telegram</b> {booking.telegram || '—'}</div>
            <div><b>Телефон</b> {booking.phone || '—'}</div>
            <div><b>Почта</b> {booking.email || '—'}</div>
            <div><b>Заявка</b> {fmt(booking.createdAt)}</div>
            <div><b>Отметка</b> {booking.attendanceMarkedAt ? fmt(booking.attendanceMarkedAt) + ' · ' + (booking.attendedBy || '') : '—'}</div>
            <div><b>Оплата</b> {booking.paid
              ? Math.round(Number(booking.paidAmount || 0) / 100) + ' EUR · ' + (booking.paidPack || '') + ' · ' + (booking.paidVia === 'manual' ? 'мимо кассы' : 'Stripe')
              : '—'}</div>
            {offerUntil && (
              <div><b>Спецоффер</b> {introActive(booking) ? 'активен до ' + fmt(offerUntil) : 'окно закрыто ' + fmt(offerUntil)}</div>
            )}
          </div>
        </div>

        {Object.keys(answers).length > 0 && (
          <div className="card">
            <h2>Ответы из воронки</h2>
            <div className="kv">
              {Object.entries(answers).map(([key, value]) => (
                <div key={key}><b>{key}</b> {value}</div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <h2>Урок</h2>
          <div className="btns">
            <form method="post" action="/api/admin/action">
              <input type="hidden" name="action" value="attended" />
              <input type="hidden" name="id" value={booking.id} />
              <input type="hidden" name="back" value={back} />
              <button className={booking.attended === true ? 'good' : ''} type="submit">
                {booking.attended === true ? 'Пришёл ✓ (снять)' : 'Пришёл'}
              </button>
            </form>
            <form method="post" action="/api/admin/action">
              <input type="hidden" name="action" value="noshow" />
              <input type="hidden" name="id" value={booking.id} />
              <input type="hidden" name="back" value={back} />
              <button className={booking.attended === false ? 'warn' : ''} type="submit">
                {booking.attended === false ? 'Не пришёл ✓ (снять)' : 'Не пришёл'}
              </button>
            </form>
            <form method="post" action="/api/admin/action">
              <input type="hidden" name="action" value="cancel" />
              <input type="hidden" name="id" value={booking.id} />
              <input type="hidden" name="back" value={back} />
              <button type="submit">Отменить запись</button>
            </form>
          </div>
          <p className="muted">
            Отметить можно только после начала урока. Повторное нажатие снимает отметку —
            вместе с ней закрывается и окно спецпредложения.
          </p>
        </div>

        <div className="card">
          <h2>Перенести</h2>
          <form method="post" action="/api/admin/action">
            <input type="hidden" name="action" value="reschedule" />
            <input type="hidden" name="id" value={booking.id} />
            <input type="hidden" name="back" value={back} />
            <div className="field">
              <label>Новое время в поясе расписания, формат 2026-09-15_17:00</label>
              <input type="text" name="slot" placeholder="2026-09-15_17:00" defaultValue={booking.slot && booking.slot !== 'no_time' ? booking.slot : ''} />
            </div>
            <button className="primary" type="submit">Перенести</button>
          </form>
          <p className="muted">Ученику уйдёт новое время в бот и на почту, напоминания пересчитаются.</p>
        </div>

        <div className="card">
          <h2>Оплата</h2>
          <form method="post" action="/api/admin/action" style={{ marginBottom: 14 }}>
            <input type="hidden" name="action" value="paylink" />
            <input type="hidden" name="id" value={booking.id} />
            <input type="hidden" name="back" value={back} />
            <div className="field">
              <label>Отправить ссылку на оплату</label>
              <select name="pack" defaultValue="">
                <option value="">— выберите пакет —</option>
                {packs.map(pack => (
                  <option key={pack.id} value={pack.id}>
                    {(pack.intro ? '🎁 ' : '') + pack.name + ' · ' + Math.round(pack.amount / 100) + ' EUR'}
                  </option>
                ))}
              </select>
            </div>
            <button className="primary" type="submit">Отправить ученику</button>
            {!introActive(booking) && (
              <p className="muted">
                Спецпредложения по 30 EUR появятся в списке после отметки «Пришёл» и живут трое суток.
              </p>
            )}
          </form>

          <form method="post" action="/api/admin/action">
            <input type="hidden" name="action" value="paid" />
            <input type="hidden" name="id" value={booking.id} />
            <input type="hidden" name="back" value={back} />
            <div className="field">
              <label>Оплата мимо кассы: сумма в евро</label>
              <input type="number" name="amount" step="1" min="1" placeholder="30" />
            </div>
            <div className="field">
              <label>Пакет (необязательно)</label>
              <input type="text" name="pack" placeholder="INTRO_IND" />
            </div>
            <button type="submit">Провести оплату</button>
          </form>
        </div>

        <div className="card">
          <h2>Написать ученику</h2>
          <form method="post" action="/api/admin/action">
            <input type="hidden" name="action" value="message" />
            <input type="hidden" name="id" value={booking.id} />
            <input type="hidden" name="back" value={back} />
            <div className="field">
              <textarea name="text" placeholder="Сообщение уйдёт в бот от имени школы" />
            </div>
            <button className="primary" type="submit">Отправить</button>
          </form>
          {!booking.chatId && <p className="muted">У этого ученика нет чата с ботом — только почта.</p>}
        </div>

        <p className="muted"><a href="/admin/work">← ко всем записям</a></p>
      </div>
    </>
  );
}
