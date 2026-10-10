import { BOT_APP_LINK, cleanChannel } from '@/lib/tgPerformance';

// Экран «Перформанс TG» (макет согласован Димой 10.10.2026).
// Итоги периода, таблица по каналам, ввод расхода на пост и генератор ссылки.
const CSS = [
  '.syad .tg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}',
  '.syad .tg-form{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}',
  '.syad .tg-link{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:#f4f4f5;border-radius:8px;padding:8px 10px;word-break:break-all}',
  '.syad .tg-num td{text-align:right}',
  '.syad .tg-num td:first-child{text-align:left}',
  '.syad .tg-num tr.muted td{color:#71717a}'
].join('\n');

function eur(cents) {
  if (cents === null || cents === undefined) return '—';

  return Math.round(Number(cents) / 100).toLocaleString('ru-RU') + ' EUR';
}

function romi(value) {
  if (value === null || value === undefined) return '—';

  return (value > 0 ? '+' : '') + value + '%';
}

export function TgPerformanceTab({ data, back, channelForLink }) {
  const t = data.total;
  const ch = cleanChannel(channelForLink);
  const link = ch ? BOT_APP_LINK + '?startapp=' + ch : '';

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="card">
        <h2>Перформанс Telegram</h2>
        <div className="kpis">
          <div className="kpi"><b>{eur(t.spend)}</b><span>расход</span></div>
          <div className="kpi"><b>{t.bookings} / {t.attended}</b><span>записались / пришли</span></div>
          <div className="kpi">
            <b>{eur(t.costPerLesson)}</b>
            <span>цена урока · Мета за период: {eur(data.meta.costPerLesson)}</span>
          </div>
          <div className="kpi"><b>{eur(t.revenue)}</b><span>выручка · ROMI {romi(t.romi)}</span></div>
        </div>
      </div>

      <div className="card">
        <h2>По каналам</h2>
        {data.rows.length === 0 ? (
          <p className="muted">За период нет ни заходов из Telegram, ни расходов. Ссылку для поста можно собрать ниже.</p>
        ) : (
          <div className="scroll">
            <table className="tg-num">
              <thead>
                <tr>
                  <th>Канал</th><th>Открыли</th><th>До времени</th><th>Записались</th><th>Отмены</th>
                  <th>Пришли</th><th>Оплатили</th><th>Выручка</th><th>Расход</th><th>Цена записи</th>
                  <th>Цена урока</th><th>ROMI</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.channel || 'none'} className={r.channel ? '' : 'muted'}>
                    <td>{r.channel ? '@' + r.channel : 'без канала'}</td>
                    <td>{r.opened}</td><td>{r.slots}</td><td>{r.bookings}</td><td>{r.cancelled}</td>
                    <td>{r.attended}</td><td>{r.paid}</td><td>{eur(r.revenue)}</td><td>{eur(r.spend)}</td>
                    <td>{eur(r.costPerBooking)}</td><td>{eur(r.costPerLesson)}</td><td>{romi(r.romi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          «Без канала»: Mini App открыт без параметра startapp, например из меню бота.
          Меньше ~7 записей на канал: шум, вердикт не выносим. Выручка считается по заявкам
          периода, даже если оплата пришла позже.
        </p>
      </div>

      <div className="tg-grid">
        <div className="card">
          <h2>Расход на канал</h2>
          <form method="post" action="/api/admin/action">
            <input type="hidden" name="action" value="tg-spend-add" />
            <input type="hidden" name="back" value={back} />
            <div className="tg-form">
              <input type="text" name="channel" placeholder="канал: cyprus_kipr" required />
              <input type="number" name="amount" step="1" min="1" placeholder="сумма, EUR" required />
              <input type="date" name="date" required />
              <input type="text" name="note" placeholder="заметка: пост / закреп" />
            </div>
            <div className="btns"><button type="submit">Добавить расход</button></div>
          </form>
          {data.spends.length > 0 && (
            <div className="scroll">
              <table>
                <tbody>
                  {data.spends.map(s => (
                    <tr key={s.id}>
                      <td>{s.date.slice(8) + '.' + s.date.slice(5, 7)}</td>
                      <td>@{s.channel}</td>
                      <td>{eur(s.amount)}</td>
                      <td className="muted">{s.note}</td>
                      <td>
                        <form method="post" action="/api/admin/action">
                          <input type="hidden" name="action" value="tg-spend-del" />
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="back" value={back} />
                          <button type="submit">удалить</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Ссылка для поста</h2>
          <form method="get" action="/admin">
            <input type="hidden" name="tab" value="telegram" />
            <input type="hidden" name="from" value={data.from} />
            <input type="hidden" name="to" value={data.to} />
            <div className="tg-form" style={{ gridTemplateColumns: '1fr auto' }}>
              <input type="text" name="ch" placeholder="канал: cyprus_kipr" defaultValue={ch} />
              <button type="submit">Собрать</button>
            </div>
          </form>
          {link && <div className="tg-link">{link}</div>}
          <p className="muted">Имя канала латиницей, без @. По нему заявка привязывается к каналу.</p>
        </div>
      </div>
    </>
  );
}
