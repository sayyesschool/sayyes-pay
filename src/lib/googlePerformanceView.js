// Экран «Перформанс Google» (макет согласован Димой 14.10.2026).
const CSS = [
  '.syad .g-num td{text-align:right}',
  '.syad .g-num td:first-child{text-align:left}',
  '.syad .g-num tr.muted td{color:#71717a}'
].join('\n');

function eur(cents) {
  if (cents === null || cents === undefined) return '—';

  return Math.round(Number(cents) / 100).toLocaleString('ru-RU') + ' EUR';
}

function eur2(value) {
  return Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR';
}

function romi(value) {
  if (value === null || value === undefined) return '—';

  return (value > 0 ? '+' : '') + value + '%';
}

function n(value) {
  return value === null || value === undefined ? '—' : Number(value).toLocaleString('ru-RU');
}

function when(iso) {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000).toISOString();

  return d.slice(8, 10) + '.' + d.slice(5, 7) + ' ' + d.slice(11, 16);
}

export function GooglePerformanceTab({ data }) {
  const t = data.total;
  const g = data.funnel.google;
  const m = data.funnel.meta;
  const status = data.report && data.report.status === 'enabled' ? 'включена'
    : data.report && data.report.status === 'paused' ? 'на паузе' : '—';

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="card">
        <h2>Перформанс Google</h2>
        <div className="kpis">
          <div className="kpi"><b>{data.hasDaily ? eur(t.spend) : '—'}</b><span>расход Google</span></div>
          <div className="kpi"><b>{t.bookings} / {t.attended}</b><span>записались / пришли</span></div>
          <div className="kpi">
            <b>{eur(t.costPerLesson)}</b>
            <span>цена урока · Мета за период: {eur(data.meta.costPerLesson)}</span>
          </div>
          <div className="kpi"><b>{eur(t.revenue)}</b><span>выручка · ROMI {romi(t.romi)}</span></div>
        </div>
        <p className="muted">
          Кампания: {status}. Последний отчёт скрипта: {when(data.report && data.report.at)} (Мск).
          {data.report && data.report.errors.length > 0 && <span className="bad"> Ошибки скрипта: {data.report.errors.join('; ')}</span>}
          {!data.hasDaily && ' Расхода по дням за этот период ещё нет: скрипт начал присылать его 14.10.2026.'}
        </p>
      </div>

      <div className="card">
        <h2>Воронка</h2>
        <div className="scroll">
          <table className="g-num">
            <thead><tr><th>Шаг</th><th>Google</th><th>Мета</th></tr></thead>
            <tbody>
              <tr><td>Клики по рекламе</td><td>{n(g.clicks)}</td><td>{n(m.clicks)}</td></tr>
              <tr><td>Открыли воронку</td><td>{n(g.landing)}</td><td>{n(m.landing)}</td></tr>
              <tr><td>Дошли до выбора времени</td><td>{n(g.slots)}</td><td>{n(m.slots)}</td></tr>
              <tr><td>Записались / отменили</td><td>{g.bookings} / {g.cancelled}</td><td>{m.bookings} / {m.cancelled}</td></tr>
              <tr><td>Урок прошёл / пришли / оплатили</td><td>{g.lessons} / {g.attended} / {g.paid}</td><td>{m.lessons} / {m.attended} / {m.paid}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>По ключевым фразам</h2>
        {data.keywords.length === 0 ? (
          <p className="muted">За период нет ни показов, ни заявок из Google.</p>
        ) : (
          <div className="scroll">
            <table className="g-num">
              <thead>
                <tr>
                  <th>Фраза</th><th>Показы</th><th>Клики</th><th>Расход</th><th>Записи</th><th>Отмены</th>
                  <th>Пришли</th><th>Оплатили</th><th>Выручка</th><th>Цена записи</th><th>Цена урока</th><th>ROMI</th>
                </tr>
              </thead>
              <tbody>
                {data.keywords.map(r => (
                  <tr key={r.keyword || 'none'} className={r.keyword ? '' : 'muted'}>
                    <td>{r.keyword || 'без фразы'}</td>
                    <td>{n(r.impressions)}</td><td>{n(r.clicks)}</td><td>{eur(r.spend)}</td>
                    <td>{r.bookings}</td><td>{r.cancelled}</td><td>{r.attended}</td><td>{r.paid}</td>
                    <td>{eur(r.revenue)}</td><td>{eur(r.costPerBooking)}</td><td>{eur(r.costPerLesson)}</td><td>{romi(r.romi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          «Без фразы»: заявка с меткой Google, но без utm_term. Меньше ~7 записей на фразу: шум, вердикт не выносим.
          Выручка считается по заявкам периода, даже если оплата пришла позже.
        </p>
      </div>

      <div className="card">
        <h2>Поисковые запросы за 7 дней</h2>
        {!data.report || data.report.searchTerms.length === 0 ? (
          <p className="muted">Запросов пока нет: кампания не показывалась.</p>
        ) : (
          <div className="scroll">
            <table className="g-num">
              <thead><tr><th>Запрос</th><th>Показы</th><th>Клики</th><th>Расход</th><th>Конверсии Google</th></tr></thead>
              <tbody>
                {data.report.searchTerms.map(s => (
                  <tr key={s.term}>
                    <td>{s.term}</td><td>{n(s.impressions)}</td><td>{n(s.clicks)}</td><td>{eur2(s.cost)}</td><td>{n(s.conversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          Что люди на самом деле вводили в поиск. Последние 7 дней из отчёта скрипта, период сверху на эту таблицу не влияет.
          Нерелевантные запросы добавляю в минус-слова.
        </p>
      </div>
    </>
  );
}
