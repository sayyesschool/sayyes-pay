import { adsManagerLink } from '@/lib/metaAds';

// Экран «Креативы»: карточка на объявление и сводная таблица.
// Окраска динамическая: каждая цифра сравнивается с другими креативами
// за тот же период. Зелёный лучше остальных, красный хуже. Если данных
// мало (меньше порога), ячейка серая: по двум заявкам хорошее от плохого
// не отличить.

const CSS = [
  '.syad .cr-sort{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px;font-size:13px}',
  '.syad .cr-sort a{padding:5px 10px;border:1px solid #e4e4e7;border-radius:9px;color:#3f3f46}',
  '.syad .cr-sort a.on{background:#16161a;border-color:#16161a;color:#fff}',
  '.syad .cr{display:grid;grid-template-columns:120px 1fr;gap:14px}',
  '.syad .cr-img{width:120px;aspect-ratio:4/5;border-radius:10px;background:#f4f4f5;overflow:hidden;position:relative}',
  '.syad .cr-img img{width:100%;height:100%;object-fit:cover;display:block}',
  '.syad .cr-img .kind{position:absolute;left:6px;bottom:6px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:2px 6px;border-radius:6px}',
  '.syad .cr-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:8px}',
  '.syad .cr-head b{font-size:15px;word-break:break-word}',
  '.syad .cr-head .muted{display:block}',
  '.syad .cr-st{font-size:11px;padding:2px 7px;border-radius:6px;white-space:nowrap}',
  '.syad .cr-st.on{background:#dcfce7;color:#166534}',
  '.syad .cr-st.off{background:#f4f4f5;color:#71717a}',
  '.syad .cr-prices{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}',
  '.syad .cr-cells{display:grid;grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:6px}',
  '.syad .cc{border-radius:9px;padding:7px 9px;background:#fafafa}',
  '.syad .cc b{display:block;font-size:16px;line-height:1.2}',
  '.syad .cr-prices .cc b{font-size:19px}',
  '.syad .cc span{display:block;font-size:11px;color:#52525b}',
  '.syad .cc i{font-style:normal;font-size:11px;color:#52525b}',
  '.syad .cc.few{background:#fafafa;color:#a1a1aa}',
  '.syad .cr-legend{display:flex;gap:10px;align-items:center;font-size:12px;color:#71717a;flex-wrap:wrap}',
  '.syad .cr-legend .sw{display:inline-block;width:70px;height:10px;border-radius:5px;background:linear-gradient(90deg,hsl(0,75%,86%),hsl(50,80%,86%),hsl(125,55%,84%))}',
  '.syad table.heat td{padding:6px 6px}',
  '.syad table.heat td.th{display:flex;gap:8px;align-items:center;min-width:170px}',
  '.syad table.heat td.th img{width:34px;height:42px;object-fit:cover;border-radius:5px;background:#f4f4f5;flex:none}',
  '.syad table.heat tr.tot td{font-weight:600;border-top:2px solid #e4e4e7}',
  '@media (max-width:640px){.syad .cr{grid-template-columns:84px 1fr;gap:10px}.syad .cr-img{width:84px}.syad .cr-prices .cc b{font-size:16px}}'
].join('');

const eur = v => (v === null || v === undefined ? '-' : Math.round(v).toLocaleString('ru-RU') + ' €');
const eur2 = v => (v === null || v === undefined ? '-' : v.toFixed(2).replace('.', ',') + ' €');
const pct = v => (v === null || v === undefined ? '-' : Math.round(v * 100) + '%');
const num = v => Number(v || 0).toLocaleString('ru-RU');

// Метрика: как достать значение, куда лучше (+1 больше лучше, -1 меньше лучше),
// и сколько нужно данных, чтобы красить.
const METRICS = {
  ctr: { get: r => r.ctr, dir: 1, enough: r => r.impressions >= 500 },
  cpc: { get: r => r.cpc, dir: -1, enough: r => r.linkClicks >= 20 },
  openRate: { get: r => r.openRate, dir: 1, enough: r => r.linkClicks >= 20 },
  contactsRate: { get: r => r.contactsRate, dir: 1, enough: r => r.landing >= 20 },
  bookRate: { get: r => r.bookRate, dir: 1, enough: r => r.landing >= 20 },
  cancelRate: { get: r => r.cancelRate, dir: -1, enough: r => r.past >= 3 },
  attendRate: { get: r => r.attendRate, dir: 1, enough: r => r.attended + r.noShow >= 3 },
  attendOfBookings: { get: r => r.attendOfBookings, dir: 1, enough: r => r.past >= 3 },
  payRate: { get: r => r.payRate, dir: 1, enough: r => r.attended >= 3 },
  // Нет ни одной записи или урока при заметном расходе: это худший результат,
  // а не «нет данных». Считаем цену бесконечной.
  costBooking: { get: r => (r.bookings ? r.costBooking : r.spend >= 15 ? Infinity : null), dir: -1, enough: r => r.spend >= 15 },
  costLesson: { get: r => (r.attended ? r.costLesson : r.spend >= 30 && r.past >= 2 ? Infinity : null), dir: -1, enough: r => r.spend >= 30 && r.past >= 2 },
  costPaid: { get: r => (r.paid ? r.costPaid : r.spend >= 60 && r.attended >= 2 ? Infinity : null), dir: -1, enough: r => r.spend >= 60 && r.attended >= 2 },
  roas: { get: r => r.roas, dir: 1, enough: r => r.spend >= 30 }
};

// Ранги, а не линейная шкала: один выброс не должен красить всех остальных
// в одинаковый цвет.
function scales(rows) {
  const out = {};

  for (const [key, m] of Object.entries(METRICS)) {
    const values = rows
      .filter(r => m.enough(r))
      .map(r => m.get(r))
      .filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    const sorted = Array.from(new Set(values)).sort((a, b) => a - b);

    out[key] = { sorted, dir: m.dir };
  }

  return out;
}

function tone(scale, key, r) {
  const m = METRICS[key];
  const s = scale[key];

  if (!m || !s || !m.enough(r)) return { cls: 'cc few' };

  const v = m.get(r);

  if (v === null || v === undefined || s.sorted.length < 2) return { cls: 'cc' };

  let t = s.sorted.indexOf(v) / (s.sorted.length - 1);

  if (s.dir < 0) t = 1 - t;

  // Красный 0, жёлтый 50, зелёный 125.
  const hue = Math.round(t * 125);

  return { cls: 'cc', style: { background: 'hsl(' + hue + ',' + (t > 0.35 && t < 0.65 ? 80 : 65) + '%,87%)' } };
}

function Cell({ scale, k, r, value, label, sub }) {
  const t = k ? tone(scale, k, r) : { cls: 'cc' };

  return (
    <div className={t.cls} style={t.style}>
      <b>{value}</b>
      <span>{label}{sub ? <i> · {sub}</i> : null}</span>
    </div>
  );
}

const price = v => (v === Infinity ? '∞' : eur(v));

function statusOf(r) {
  if (!r.status) return null;

  return r.status === 'ACTIVE' ? { cls: 'cr-st on', label: 'активно' } : { cls: 'cr-st off', label: 'на паузе' };
}

function sortRows(rows, sort) {
  const key = {
    lesson: r => (r.attended ? r.costLesson : r.spend > 0 ? 1e9 + r.spend : 2e9),
    bookings: r => -r.bookings,
    attended: r => -r.attended,
    spend: r => -r.spend
  }[sort] || (r => -r.spend);

  return rows.slice().sort((a, b) => key(a) - key(b));
}

function Card({ r, scale }) {
  const st = statusOf(r);

  return (
    <div className="card">
      <div className="cr">
        <a className="cr-img" href={adsManagerLink(r.id)} target="_blank" rel="noreferrer">
          {r.image ? <img src={r.image} alt="" referrerPolicy="no-referrer" loading="lazy" /> : null}
          {r.kind ? <span className="kind">{r.kind === 'video' ? 'видео' : 'статика'}</span> : null}
        </a>
        <div>
          <div className="cr-head">
            <div>
              <b>{r.name || r.id}</b>
              <span className="muted">
                {r.adset || 'группа неизвестна'} · <a href={adsManagerLink(r.id)} target="_blank" rel="noreferrer">Ads Manager ↗</a>
              </span>
            </div>
            {st ? <span className={st.cls}>{st.label}</span> : null}
          </div>

          <div className="cr-prices">
            <Cell scale={scale} k="costLesson" r={r} value={price(METRICS.costLesson.get(r))} label="цена урока" />
            <Cell scale={scale} k="costBooking" r={r} value={price(METRICS.costBooking.get(r))} label="цена записи" />
            <Cell scale={scale} k="costPaid" r={r} value={price(METRICS.costPaid.get(r))} label="цена оплаты" />
          </div>

          <div className="cr-cells">
            <Cell value={eur(r.spend)} label="расход" />
            <Cell scale={scale} k="ctr" r={r} value={num(r.linkClicks)} label="клики" sub={'CTR ' + (r.ctr === null ? '-' : (r.ctr * 100).toFixed(1) + '%')} />
            <Cell scale={scale} k="cpc" r={r} value={eur2(r.cpc)} label="цена клика" />
            <Cell scale={scale} k="openRate" r={r} value={num(r.landing)} label="открыли" sub={pct(r.openRate) + ' кликов'} />
            <Cell scale={scale} k="contactsRate" r={r} value={num(r.contacts)} label="до контактов" sub={pct(r.contactsRate)} />
            <Cell scale={scale} k="bookRate" r={r} value={num(r.bookings)} label="записались" sub={pct(r.bookRate) + ' открывших'} />
            <Cell scale={scale} k="cancelRate" r={r} value={num(r.cancelled)} label="отменены" sub={pct(r.cancelRate)} />
            <Cell value={num(r.upcoming)} label="урок впереди" />
            <Cell scale={scale} k="attendRate" r={r} value={num(r.attended)} label="пришли" sub={pct(r.attendRate) + ' уроков'} />
            <Cell scale={scale} k="attendOfBookings" r={r} value={pct(r.attendOfBookings)} label="пришли из записей" />
            <Cell scale={scale} k="payRate" r={r} value={num(r.paid)} label="оплатили" sub={pct(r.payRate) + ' пришедших'} />
            <Cell scale={scale} k="roas" r={r} value={eur(r.revenue / 100)} label="выручка" sub={r.roas === null ? '' : 'ROAS ' + r.roas.toFixed(2).replace('.', ',')} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HeatRow({ r, scale, total }) {
  const td = (k, value) => {
    const t = k && !total ? tone(scale, k, r) : {};

    return <td style={t.cls === 'cc few' ? { color: '#a1a1aa' } : t.style}>{value}</td>;
  };

  return (
    <tr className={total ? 'tot' : ''}>
      <td className="th">
        {total ? null : (r.image ? <img src={r.image} alt="" referrerPolicy="no-referrer" loading="lazy" /> : <img alt="" />)}
        {total ? 'Все креативы' : <a href={adsManagerLink(r.id)} target="_blank" rel="noreferrer">{r.name || r.id}</a>}
      </td>
      {td(null, eur(r.spend))}
      {td('ctr', r.ctr === null ? '-' : (r.ctr * 100).toFixed(1) + '%')}
      {td('cpc', eur2(r.cpc))}
      {td('openRate', num(r.landing))}
      {td('bookRate', num(r.bookings))}
      {td('costBooking', price(METRICS.costBooking.get(r)))}
      {td('cancelRate', pct(r.cancelRate))}
      {td(null, num(r.upcoming))}
      {td('attendRate', num(r.attended))}
      {td('costLesson', price(METRICS.costLesson.get(r)))}
      {td('payRate', num(r.paid))}
      {td('costPaid', price(METRICS.costPaid.get(r)))}
      {td('roas', r.roas === null ? '-' : r.roas.toFixed(2).replace('.', ','))}
    </tr>
  );
}

export function CreativesTab({ data, sort, sortLink, since }) {
  const rows = sortRows(data.rows, sort);
  const scale = scales(data.rows);
  const sorts = [['spend', 'по расходу'], ['lesson', 'по цене урока'], ['bookings', 'по записям'], ['attended', 'по пришедшим']];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {!data.adsOk && (
        <div className="card warn">
          <h2>Кабинет недоступен</h2>
          <p className="muted">{data.adsReason} Расхода и картинок нет, остальное считается по нашей базе.</p>
        </div>
      )}

      {data.range.from < since && (
        <div className="card warn">
          <p className="muted">До {since.slice(8)}.{since.slice(5, 7)} у объявлений не было ad_id в ссылке: заявки тех дней не привязаны к креативам, и цена за них завышена.</p>
        </div>
      )}

      <div className="card">
        <h2>Все креативы за период</h2>
        <div className="kpis">
          <div className="kpi"><b>{eur(data.total.spend)}</b><span>расход</span></div>
          <div className="kpi"><b>{num(data.total.bookings)}</b><span>записей · {eur(data.total.costBooking)} за запись</span></div>
          <div className="kpi"><b>{num(data.total.attended)}</b><span>пришли · {eur(data.total.costLesson)} за урок</span></div>
          <div className="kpi"><b>{num(data.total.paid)}</b><span>оплат · {eur(data.total.costPaid)} за оплату</span></div>
          <div className="kpi"><b>{num(data.total.upcoming)}</b><span>уроков ещё впереди</span></div>
          <div className="kpi"><b>{pct(data.total.cancelRate)}</b><span>отмен от прошедших записей</span></div>
        </div>
        {data.untagged && data.untagged.bookings > 0 && (
          <p className="muted" style={{ marginTop: 10 }}>
            Ещё {data.untagged.bookings} записей без метки объявления (пришли {data.untagged.attended}, оплатили {data.untagged.paid}): органика, старые ссылки или потерянная метка. В сравнение не входят.
          </p>
        )}
        <div className="cr-legend">
          <span className="sw" /> хуже остальных ← → лучше остальных за этот период. Серое: мало данных для сравнения.
        </div>
      </div>

      <div className="cr-sort">
        <span className="muted">Порядок:</span>
        {sorts.map(([key, label]) => (
          <a key={key} className={sort === key ? 'on' : ''} href={sortLink(key)}>{label}</a>
        ))}
      </div>

      {rows.length === 0 && <div className="card"><p className="muted">За период нет ни расхода, ни заявок по объявлениям.</p></div>}

      {rows.map(r => <Card key={r.id} r={r} scale={scale} />)}

      {rows.length > 1 && (
        <div className="card">
          <h2>Сравнение</h2>
          <div className="scroll">
            <table className="heat">
              <thead>
                <tr>
                  <th>Креатив</th><th>Расход</th><th>CTR</th><th>Клик</th><th>Открыли</th><th>Записи</th><th>Запись</th>
                  <th>Отмены</th><th>Впереди</th><th>Пришли</th><th>Урок</th><th>Оплаты</th><th>Оплата</th><th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => <HeatRow key={r.id} r={r} scale={scale} />)}
                <HeatRow r={data.total} scale={scale} total />
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="muted">
        Когорта: записи, созданные в выбранные даты, и расход Меты за те же даты. Судьба записи на сегодня,
        поэтому у свежих дат часть уроков ещё впереди. Цена урока = расход / пришедшие. Меньше ~7 записей на креатив это шум.
      </p>
    </>
  );
}
