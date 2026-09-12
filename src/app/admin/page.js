import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { buildAnalytics } from '@/lib/analytics';
import { getAdsInsights } from '@/lib/metaAds';

export const dynamic = 'force-dynamic';

const CSS = [
  '*{box-sizing:border-box}',
  'body{margin:0;background:#f6f6f8;color:#16161a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5}',
  '.wrap{max-width:940px;margin:0 auto;padding:16px 14px 60px}',
  '.top{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between;margin-bottom:14px}',
  '.top h1{font-size:20px;margin:0}',
  '.who{font-size:13px;color:#71717a}',
  '.tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap}',
  '.tab{padding:6px 12px;border-radius:999px;background:#fff;border:1px solid #e4e4e7;color:#3f3f46;text-decoration:none;font-size:13px}',
  '.tab.on{background:#16161a;color:#fff;border-color:#16161a}',
  '.card{background:#fff;border:1px solid #ececf0;border-radius:14px;padding:14px;margin-bottom:12px}',
  '.card h2{font-size:15px;margin:0 0 12px}',
  '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}',
  '.kpi{background:#fafafa;border-radius:10px;padding:10px 12px}',
  '.kpi b{display:block;font-size:20px;line-height:1.2}',
  '.kpi span{font-size:12px;color:#71717a}',
  '.step{margin-bottom:10px}',
  '.step .line{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px}',
  '.step .bar{height:10px;border-radius:6px;background:#ececf0;overflow:hidden}',
  '.step .bar i{display:block;height:100%;background:#6d28d9}',
  '.muted{color:#71717a;font-size:13px}',
  'table{width:100%;border-collapse:collapse;font-size:13px}',
  'th,td{text-align:right;padding:6px 4px;border-bottom:1px solid #f1f1f4;white-space:nowrap}',
  'th:first-child,td:first-child{text-align:left;white-space:normal}',
  'th{color:#71717a;font-weight:500}',
  '.scroll{overflow-x:auto}',
  '.warn{background:#fff7ed;border-color:#fed7aa}',
  '.bad{color:#b91c1c}',
  '.ok{color:#15803d}'
].join('');

function money(cents) {
  return Math.round(Number(cents || 0) / 100).toLocaleString('ru-RU') + ' EUR';
}

function euro(value) {
  return Math.round(Number(value || 0)).toLocaleString('ru-RU') + ' EUR';
}

function ratio(a, b) {
  if (!b) return '—';

  return (a / b).toFixed(2);
}

export default async function AdminPage({ searchParams }) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');

  const params = await searchParams;
  const days = [7, 30, 90].includes(Number(params?.days)) ? Number(params.days) : 30;
  const data = await buildAnalytics({ days });
  const owner = session.role === 'owner';
  const ads = owner ? await getAdsInsights(days) : null;
  const top = data.funnel[0].value || 1;
  const attended = data.totals.attended;
  const spend = ads && ads.ok ? ads.spend : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        <div className="top">
          <h1>SAY YES — аналитика</h1>
          <div className="who">@{session.username} · {owner ? 'управляющий' : 'менеджер'}</div>
        </div>

        <div className="tabs">
          {[7, 30, 90].map(value => (
            <a key={value} className={'tab' + (value === days ? ' on' : '')} href={'/admin?days=' + value}>
              {value} дней
            </a>
          ))}
        </div>

        <div className="card">
          <h2>Путь от клика до оплаты</h2>
          {data.funnel.map(step => (
            <div className="step" key={step.key}>
              <div className="line">
                <span>{step.label}</span>
                <span><b>{step.value}</b>{step.of === null ? '' : ' · ' + step.of + '%'}</span>
              </div>
              <div className="bar"><i style={{ width: Math.max(1, Math.round((step.value / top) * 100)) + '%' }} /></div>
            </div>
          ))}
          <p className="muted">
            Проценты — переход от предыдущего шага. «Пришли» считаются от уроков в этом периоде,
            а не от заявок: урок часто в другой день.
          </p>
        </div>

        {owner && (
          <div className="card">
            <h2>Деньги</h2>
            <div className="kpis">
              <div className="kpi"><b>{money(data.money.revenue)}</b><span>выручка за период</span></div>
              <div className="kpi"><b>{data.money.payments}</b><span>оплат, средний чек {money(data.money.averageCheck)}</span></div>
              <div className="kpi"><b>{data.money.direct} из {data.money.payments}</b><span>прямых через Stripe</span></div>
              <div className="kpi"><b>{spend === null ? '—' : euro(spend)}</b><span>расход на рекламу</span></div>
              <div className="kpi"><b>{spend === null ? '—' : euro(spend / (data.totals.bookings || 1))}</b><span>цена заявки</span></div>
              <div className="kpi"><b>{spend === null ? '—' : euro(spend / (attended || 1))}</b><span>цена дошедшего</span></div>
              <div className="kpi"><b>{spend === null ? '—' : euro(spend / (data.totals.paid || 1))}</b><span>цена оплаты</span></div>
              <div className="kpi"><b>{spend ? ratio(data.money.revenue / 100, spend) : '—'}</b><span>окупаемость, евро на евро</span></div>
            </div>
            {ads && !ads.ok && <p className="muted">{ads.reason}</p>}
          </div>
        )}

        {owner && ads && ads.ok && ads.campaigns.length > 0 && (
          <div className="card">
            <h2>Кампании</h2>
            <div className="scroll">
              <table>
                <thead><tr><th>Кампания</th><th>Расход</th><th>Клики</th><th>Цена клика</th></tr></thead>
                <tbody>
                  {ads.campaigns.map(row => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{euro(row.spend)}</td>
                      <td>{row.clicks}</td>
                      <td>{row.clicks ? (row.spend / row.clicks).toFixed(2) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="card">
          <h2>Уроки по дням</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Дата</th><th>Уроков</th><th>Пришли</th><th>Не пришли</th><th>Без отметки</th><th>Оплат</th></tr>
              </thead>
              <tbody>
                {data.lessons.filter(row => row.lessons > 0).reverse().map(row => (
                  <tr key={row.date}>
                    <td>{row.date.slice(8)}.{row.date.slice(5, 7)}</td>
                    <td>{row.lessons}</td>
                    <td className={row.attended ? 'ok' : ''}>{row.attended}</td>
                    <td>{row.noshow}</td>
                    <td className={row.unmarked ? 'bad' : ''}>{row.unmarked}</td>
                    <td>{row.paid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Заявки по дням</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Дата</th><th>Визиты</th><th>Квиз</th><th>Заявки</th><th>Подтвердили</th><th>Отмены</th></tr>
              </thead>
              <tbody>
                {data.daily.filter(row => row.visits || row.bookings).reverse().map(row => (
                  <tr key={row.date}>
                    <td>{row.date.slice(8)}.{row.date.slice(5, 7)}</td>
                    <td>{row.visits}</td>
                    <td>{row.quiz}</td>
                    <td><b>{row.bookings}</b></td>
                    <td>{row.confirmed}</td>
                    <td>{row.cancelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {Object.entries(data.segments).map(([field, rows]) => rows.length > 0 && (
          <div className="card" key={field}>
            <h2>{field}</h2>
            <div className="scroll">
              <table>
                <thead><tr><th>{field}</th><th>Заявок</th><th>Дошли</th><th>Доходимость</th><th>Оплат</th></tr></thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.value}>
                      <td>{row.value}</td>
                      <td>{row.bookings}</td>
                      <td>{row.attended}</td>
                      <td>{row.attendedPct === null ? '—' : row.attendedPct + '%'}</td>
                      <td>{row.paid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className={'card' + (data.health.unmarkedOld ? ' warn' : '')}>
          <h2>Что требует внимания</h2>
          <div className="kpis">
            <div className="kpi"><b className={data.health.unmarkedOld ? 'bad' : ''}>{data.health.unmarkedOld}</b><span>уроков без отметки старше суток</span></div>
            <div className="kpi"><b>{data.health.pending}</b><span>заявок без времени</span></div>
            <div className="kpi"><b>{data.health.reviveQueue}</b><span>в очереди реанимации</span></div>
            <div className="kpi"><b>{data.health.noChat}</b><span>без чата с ботом</span></div>
            <div className="kpi"><b>{data.health.noEmail}</b><span>без почты</span></div>
            <div className="kpi"><b className={data.health.noContact ? 'bad' : ''}>{data.health.noContact}</b><span>вообще без контактов</span></div>
          </div>
        </div>

        <p className="muted">
          Период: {data.range.from} — {data.range.to}. Границы суток — в поясе расписания (UTC+3),
          как в боте. Архивные и тестовые заявки в расчёт не идут.
        </p>
      </div>
    </>
  );
}
