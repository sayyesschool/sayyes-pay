import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession, can } from '@/lib/adminAuth';
import { statusTags } from '@/lib/adminUi';
import { Shell } from '@/lib/adminShell';
import { getBooking, getBookedSlots } from '@/lib/redis';
import { isSlotClosed } from '@/lib/capacity';
import { today, shiftDay, slotStartMs } from '@/lib/analytics';
import { getThread } from '@/lib/thread';
import { listPacks, payLink } from '@/lib/adminActions';
import { introActive, introExpiry } from '@/services/intro';
import { sourceLine } from '@/lib/leadSource';
import { getProfiles } from '@/lib/access';
import { mskText } from '@/lib/offerChain';

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
  const session = await readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');
  if (!can(session, 'base')) redirect('/admin/work');

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
  const thread = await getThread(id);
  const days = [];

  for (let i = 0; i < 14; i++) days.push(shiftDay(today(), i));
  const answers = booking.quizAnswers || {};
  const offerUntil = introExpiry(booking);
  const offerNames = booking.attended === true && !booking.offer ? (await getProfiles()).filter(p => p.name) : [];
  const offer = booking.offer || null;
  const offerState = !offer ? '' : offer.stopped ? 'остановлена' : booking.introPaid ? 'оплачено' : offer.done ? 'завершена' : offer.paused ? 'на паузе: ученик ответил, дальше пишет менеджер' : 'идёт';
  const stepLine = n => {
    if (!offer) return '';
    if (offer.sent && offer.sent[n]) return n + ' ✓ ' + mskText(new Date(offer.sent[n]).getTime());
    if (offer.sent && offer.sent[n + '_skip']) return n + ' пропущено';
    if (!offer.plan || !offer.plan[n]) return n + ' не нужно';
    return n + ' в план ' + mskText(new Date(offer.plan[n]).getTime());
  };

  return (
    <Shell session={session} active="work" title={booking.name || 'Без имени'}>
        {message && <div className={'msg' + (message.startsWith('Ошибка') ? ' err' : '')}>{message}</div>}

        <div className="card">
          <div style={{ marginBottom: 8 }}>
            {statusTags(booking).map(([cls, label], i) => <span key={i} className={'tag ' + cls}>{label}</span>)}
          </div>
          <div className="kv">
            <div><b>Код</b> {booking.id}</div>
            <div><b>Источник</b> {sourceLine(booking)}</div>
            <div><b>Урок</b> {booking.slotDate || '—'} {booking.slotMsk || ''} (МСК)</div>
            <div><b>Telegram</b> {booking.telegram || '—'}</div>
            <div><b>Телефон</b> {booking.phone || '—'}</div>
            <div><b>Почта</b> {booking.email || '—'}</div>
            {booking.emailOk === false && (
              <div>
                <b>Письмо</b> не дошло{booking.emailNote ? ' · ' + booking.emailNote : ''}
              </div>
            )}
            <div><b>Заявка</b> {fmt(booking.createdAt)}</div>
            <div><b>Отметка</b> {booking.attendanceMarkedAt ? fmt(booking.attendanceMarkedAt) + ' · ' + (booking.attendedBy || '') : '—'}</div>
            <div><b>Оплата</b> {booking.paid
              ? Math.round(Number(booking.paidAmount || 0) / 100) + ' EUR · ' + (booking.paidPack || '') + ' · ' + (booking.paidVia === 'manual' ? 'мимо кассы' : 'Stripe')
                + (Number(booking.paymentsCount || 1) > 1 ? ' · всего оплат ' + booking.paymentsCount + ' на ' + Math.round(Number(booking.paidTotal || 0) / 100) + ' EUR' : '')
              : '—'}</div>
            {offerUntil && (
              <div><b>Спецоффер</b> {booking.introNoExpiry ? (booking.introPaid ? 'оплачен' : 'ссылка без срока, до оплаты') : introActive(booking) ? 'активен до ' + fmt(offerUntil) : 'окно закрыто ' + fmt(offerUntil)}</div>
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
            {booking.email && (
              <form method="post" action="/api/admin/action">
                <input type="hidden" name="action" value="resend-mail" />
                <input type="hidden" name="id" value={booking.id} />
                <input type="hidden" name="back" value={back} />
                <button type="submit">Дослать письмо</button>
              </form>
            )}
            {booking.status !== 'cancelled' && booking.attended !== true && (booking.chatId || booking.email) && (
              <form method="post" action="/api/admin/action">
                <input type="hidden" name="action" value="offer-reschedule" />
                <input type="hidden" name="id" value={booking.id} />
                <input type="hidden" name="back" value={back} />
                <button type="submit">📅 Предложить перенос</button>
              </form>
            )}
            {(booking.releasedUnconfirmed || booking.status === 'cancelled') && (
              <form method="post" action="/api/admin/action">
                <input type="hidden" name="action" value="restore" />
                <input type="hidden" name="id" value={booking.id} />
                <input type="hidden" name="back" value={back} />
                <button className="primary" type="submit">Вернуть запись</button>
              </form>
            )}
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

        {booking.attended === true && (
          <div className="card">
            <h2>Оффер после пробного</h2>
            {!offer && !booking.introPaid && (offerNames.length ? (
              <form method="post" action="/api/admin/action">
                <input type="hidden" name="action" value="offer-launch" />
                <input type="hidden" name="id" value={booking.id} />
                <input type="hidden" name="back" value={back} />
                <div className="field">
                  <label>От чьего имени</label>
                  <select name="manager" defaultValue={offerNames.some(p => p.username === session.username) ? session.username : ''} required>
                    <option value="" disabled>— выберите имя —</option>
                    {offerNames.map(p => <option key={p.username} value={p.username}>{p.name}</option>)}
                  </select>
                </div>
                <button className="primary" type="submit">🎁 Запустить оффер</button>
                <p className="muted">
                  Сообщение 1 уйдёт сразу (днём по времени ученика), дальше цепочка сама: напоминания
                  до конца оффера и вопрос «что помешало» утром после. Ссылку вручную отправлять не нужно.
                </p>
              </form>
            ) : (
              <p className="muted">Нет ни одного «Имени для клиентов»: заполните его в разделе «Доступы».</p>
            ))}
            {offer && (
              <>
                <p>
                  От имени <b>{offer.manager.name}</b>, конец оффера {mskText(new Date(offer.deadline).getTime())} МСК.
                  Статус: <b>{offerState}</b>.
                </p>
                <p className="muted">Сообщения: {[1, 2, 3, 4].map(stepLine).join(' · ')}</p>
                {!offer.stopped && !offer.done && !booking.introPaid && (
                  <form method="post" action="/api/admin/action">
                    <input type="hidden" name="action" value="offer-stop" />
                    <input type="hidden" name="id" value={booking.id} />
                    <input type="hidden" name="back" value={back} />
                    <button type="submit">⏹ Остановить цепочку</button>
                    <span className="muted"> Нужна, если ученик ответил на письмо: ответы на почту система не видит.</span>
                  </form>
                )}
              </>
            )}
            {booking.offerReason && <p>Что помешало: <b>{booking.offerReason.text}</b></p>}
          </div>
        )}

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
            {booking.attended !== true && (
              <p className="muted">
                Спецпредложения по 30 EUR появятся в списке после отметки «Пришёл» и живут трое суток.
              </p>
            )}
            {booking.attended === true && !booking.introPaid && !introActive(booking) && (
              <p className="muted">
                Трое суток прошли. Спецпредложение можно отправить ещё раз: ссылка будет без срока,
                купить пакет можно один раз.
              </p>
            )}
          </form>

          {/* Ссылка руками: бот есть не у всех — кому-то пишем в WhatsApp или почтой.
              Клиентского JS в админке нет, поэтому показываем готовые ссылки на все
              доступные пакеты, а не пересобираем одну по выбору в списке выше. */}
          <details className="sub" style={{ marginBottom: 14 }}>
            <summary>Скопировать ссылку вручную</summary>
            <p className="muted">
              Те же ссылки, что уходят кнопкой выше. Нужны, когда пишете ученику не из бота.
            </p>
            {packs.length === 0 && <p className="muted">Прайс не загрузился, ссылок нет.</p>}
            {packs.map(pack => (
              <div className="field" key={pack.id}>
                <label>
                  {(pack.intro ? '🎁 ' : '') + pack.name + ' · ' + Math.round(pack.amount / 100) + ' EUR'}
                </label>
                <input className="link" type="text" readOnly value={payLink(booking.id, pack.id)} />
              </div>
            ))}
          </details>

          <form method="post" action="/api/admin/action">
            <input type="hidden" name="action" value="paid" />
            <input type="hidden" name="id" value={booking.id} />
            <input type="hidden" name="back" value={back} />
            <div className="field">
              <label>Оплата мимо кассы: сумма в евро</label>
              <input type="number" name="amount" step="1" min="1" placeholder="30" required />
            </div>
            <div className="field">
              <label>Пакет</label>
              <select name="pack" defaultValue="" required>
                <option value="" disabled>выберите пакет</option>
                <option value="INTRO_IND">Intro_Ind</option>
                <option value="INTRO_GRP">Intro_Group</option>
                <option value="IND">Ind</option>
                <option value="GRP">Group</option>
              </select>
            </div>
            <button type="submit">Провести оплату</button>
          </form>
        </div>

        <div className="card">
          <h2>Переписка</h2>
          {thread.length > 0 ? (
            <div className="thread">
              {thread.map((item, index) => (
                <div className={'bubble ' + (item.from === 'student' ? 'in' : 'out')} key={index} style={{ whiteSpace: 'pre-wrap' }}>
                  {item.channel === 'email' && item.subject ? <b style={{ display: 'block', marginBottom: 4 }}>✉️ {item.subject}</b> : null}
                  {item.text}
                  <span className="meta">
                    {item.channel === 'email' ? '✉️ письмо · ' : ''}
                    {item.from === 'student' ? 'ученик' : (item.by || 'школа')} · {fmt(item.at)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Переписки пока нет. Здесь будут и ответы ученика из бота, и ваши сообщения.</p>
          )}
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
          {booking.email && (
            <form method="post" action="/api/admin/action" style={{ marginTop: 14 }}>
              <input type="hidden" name="action" value="mail-reply" />
              <input type="hidden" name="id" value={booking.id} />
              <input type="hidden" name="back" value={back} />
              {booking.mailLastInboundAt && (
                <p className="muted">
                  Последний ответ письмом: {fmt(booking.mailLastInboundAt)}
                  {booking.mailLastMatch === 'headers' ? ' (привязан по метке письма)' : ' (привязан по адресу ученика)'}.
                </p>
              )}
              <div className="field">
                <label>Ответить письмом на {booking.email}</label>
                <textarea name="text" placeholder="Письмо уйдёт от info@sayyestoenglish.com с вашим именем в строке «От кого»" />
              </div>
              <button type="submit">✉️ Ответить письмом</button>
            </form>
          )}
        </div>

        <p className="muted"><a href="/admin/work">← ко всем записям</a></p>
    </Shell>
  );
}
