import { WEEK_COLS } from '@/lib/cohorts';

// Вкладка «Когорты» (макет согласован Димой 18.11.2026).
const CSS = [
  '.syad .coh td{text-align:right;white-space:nowrap}',
  '.syad .coh td:first-child,.syad .coh th:first-child{text-align:left}',
  '.syad .coh tr.tot td{font-weight:700;border-top:2px solid #e7e7ec}',
  '.syad .coh .pos{color:#15803d}',
  '.syad .coh .neg{color:#b91c1c}',
  '.syad .coh td.paid{background:#e5f4e4}',
  '.syad .steps{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}',
  '.syad .steps a{padding:4px 10px;border:1px solid #e7e7ec;border-radius:999px;font-size:13px}',
  '.syad .steps a.on{background:#6d28d9;color:#fff;border-color:#6d28d9}'
].join('\n');

const eur = cents => (cents === null || cents === undefined) ? '—' : Math.round(Number(cents) / 100).toLocaleString('ru-RU') + ' €';
const ratio = v => v === null || v === undefined ? '—' : (Math.round(v * 100) / 100).toLocaleString('ru-RU');
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
const romi = v => v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v + '%';

export function CohortsTab({ data, linkFor }) {
  const steps = [['week', 'Неделя'], ['day', 'День'], ['month', 'Месяц']];
  const sources = [['all', 'Все'], ['meta', 'Мета'], ['telegram', 'TG'], ['google', 'Google'], ['organic', 'Органика']];
  const t = data.total;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="card">
        <div className="steps">
          {steps.map(([k, l]) => <a key={k} className={data.step === k ? 'on' : ''} href={linkFor({ step: k })}>{l}</a>)}
          <span className="muted" style={{ margin: '0 6px' }}>·</span>
          {sources.map(([k, l]) => <a key={k} className={data.source === k ? 'on' : ''} href={linkFor({ csrc: k })}>{l}</a>)}
        </div>

        <h2>Окупаемость когорт</h2>
        {!data.metaOk && <p className="muted">Кабинет Меты не ответил: расход Меты не учтён.</p>}
        <div className="scroll">
          <table className="coh">
            <thead>
              <tr>
                <th>Когорта</th><th>Расход</th><th>Заявок</th><th>Пришли</th><th>Оплатили</th>
                <th>Выручка факт</th><th>Выручка / расход</th><th>ROMI</th><th>Цена оплатившего</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td>{eur(r.spend)}</td>
                  <td>{r.leads}</td>
                  <td>{r.attended}</td>
                  <td>{r.payers}</td>
                  <td>{eur(r.revenue)}</td>
                  <td>{ratio(r.ratio)}</td>
                  <td className={r.romi === null ? '' : r.romi >= 0 ? 'pos' : 'neg'}>{romi(r.romi)}</td>
                  <td>{eur(r.cac)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td>Итого</td>
                <td>{eur(t.spend)}</td>
                <td>{t.leads}</td>
                <td>{t.attended}</td>
                <td>{t.payers}</td>
                <td>{eur(t.revenue)}</td>
                <td>{ratio(t.ratio)}</td>
                <td className={t.romi === null ? '' : t.romi >= 0 ? 'pos' : 'neg'}>{romi(t.romi)}</td>
                <td>{eur(t.cac)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          Когорта - заявки, оставленные в этот период; расход за те же дни. Выручка - все оплаты этих людей до сегодня
          за вычетом комиссии Stripe и возвратов. ROMI = (выручка - расход) / расход.
          {data.unlinked.count > 0 && <> Оплаты без заявки за период: {data.unlinked.count} на {eur(data.unlinked.revenue)} (в когорты не входят).</>}
          {data.feesPending > 0 && <> Комиссия Stripe ещё не подгружена для {data.feesPending} оплат: обновите страницу.</>}
        </p>
      </div>

      <div className="card">
        <h2>Записи и оплаты когорт</h2>
        <div className="scroll">
          <table className="coh">
            <thead>
              <tr>
                <th>Когорта</th><th>Заявок</th><th>Записались</th><th>Подтвердили</th><th>Дошли</th>
                <th>Доходимость</th><th>1-я оплата</th><th>2-я оплата</th><th>3-я и дальше</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.concat([{ ...t, key: 'total', label: 'Итого', tot: true }]).map(r => (
                <tr key={r.key} className={r.tot ? 'tot' : ''}>
                  <td>{r.label}</td>
                  <td>{r.leads}</td>
                  <td>{r.booked}</td>
                  <td>{r.confirmed}{r.booked ? <span className="muted"> · {pct(r.confirmed, r.booked)}</span> : null}</td>
                  <td>{r.attended}</td>
                  <td>{pct(r.attended, r.booked)}</td>
                  <td>{r.pay1}{r.attended ? <span className="muted"> · {pct(r.pay1, r.attended)}</span> : null}</td>
                  <td>{r.pay2}{r.pay1 ? <span className="muted"> · {pct(r.pay2, r.pay1)}</span> : null}</td>
                  <td>{r.pay3}{r.pay2 ? <span className="muted"> · {pct(r.pay3, r.pay2)}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Записались - заявки с выбранным временем урока. Подтвердили - нажали «Буду на уроке» (или пришли).
          Доходимость - дошли от записавшихся. Проценты у оплат: 1-я от дошедших, 2-я от сделавших 1-ю, 3-я от сделавших 2-ю.
        </p>
      </div>

      <div className="card">
        <h2>Как копится выручка когорты</h2>
        <div className="scroll">
          <table className="coh">
            <thead>
              <tr>
                <th>Когорта</th><th>Расход</th>
                {Array.from({ length: WEEK_COLS }, (_, i) => <th key={i}>{i === WEEK_COLS - 1 ? 'Нед. ' + i + '+' : 'Нед. ' + i}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td>{eur(r.spend)}</td>
                  {r.cumulative.map((v, i) => (
                    <td key={i} className={v !== null && r.spend > 0 && v >= r.spend ? 'paid' : ''}>{v === null ? '' : eur(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">Выручка нарастающим итогом по неделям от заявки. Зелёным - когорта окупила расход.</p>
      </div>
    </>
  );
}
