import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { statusTags } from '@/lib/adminUi';
import { Shell } from '@/lib/adminShell';
import { getBooking, getBookedSlots } from '@/lib/redis';
import { isSlotClosed } from '@/lib/capacity';
import { today, shiftDay, slotStartMs } from '@/lib/analytics';
import { listPacks } from '@/lib/adminActions';
import { introActive, introExpiry } from '@/services/intro';

export const dynamic = 'force-dynamic';

// Сетка расписания в базовом поясе: с 10:00 до 20:00 каждые полчаса.
const GRID = [];

for (let h = 10; h <= 20; h++) {
  GRID.push(String(h).padStart(2, '0') + ':00');
  if (h < 20) GRID.push(String(h).padStart(2, '0') + ':30');
}

const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

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
      <Shell session={session} active="work" title="Запись не найдена">
        <p>Записи с кодом {id} нет. <a href="/admin/work">Вернуться к работе</a></p>
      </Shell>
    );
  }

  const back = '/admin/client/' + id;
  const packs = await listPacks(booking);
  const booked = await getBookedSlots();
  const days = [];

  for (let i = 0; i < 14; i++) days.push(shiftDay(today(), i));
  const answers = booking.quizAnswers || {};
  const offerUntil = introExpiry(booking);

  return (
    <Shell session={session} active="work" title={booking.name || 'Без имени'}>
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

        <details className="block">
          <summary>
            <span>Перенести</span>
            <span className="count">{booking.slotDate ? booking.slotDate + ' ' + (booking.slotMsk || '') : 'времени нет'}</span>
          </summary>
          <div className="body">
            {days.map(day => {
              const free = GRID.filter(time => {
                const key = day + '_' + time;

                return !isSlotClosed(key) && slotStartMs({ slot: key }) > Date.now();
              });

              if (!free.length) return null;

              const label = new Date(day + 'T00:00:00Z');

              return (
                <div key={day}>
                  <div className="sub-h">
                    {day.slice(8)}.{day.slice(5, 7)}, {DOW[label.getUTCDay()]}
                  </div>
                  <div className="slots">
                    {free.map(time => {
                      const key = day + '_' + time;
                      const mine = key === booking.slot;
                      const taken = booked.includes(key) && !mine;

                      if (taken) return <span className="slot off" key={key}>{time}</span>;
                      if (mine) return <span className="slot mine" key={key}>{time}</span>;

                      return (
                        <form method="post" action="/api/admin/action" key={key}>
                          <input type="hidden" name="action" value="reschedule" />
                          <input type="hidden" name="id" value={booking.id} />
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="slot" value={key} />
                          <button className="slot" type="submit">{time}</button>
                        </form>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <p className="muted">
              Серым и зачёркнутым — занятые слоты, их видно, чтобы не предлагать ученику
              то, что уже отдано. Закрытые дни в сетке не показываются вовсе.
              Время в поясе расписания (UTC+3).
            </p>

            <form method="post" action="/api/admin/action">
              <input type="hidden" name="action" value="reschedule" />
              <input type="hidden" name="id" value={booking.id} />
              <input type="hidden" name="back" value={back} />
              <div className="field">
                <label>Другое время вне сетки, формат 2026-09-15_17:00</label>
                <input type="text" name="slot" placeholder="2026-09-15_17:00" />
              </div>
              <button className="primary" type="submit">Перенести</button>
            </form>
          </div>
        </details>

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
    </Shell>
  );
}
