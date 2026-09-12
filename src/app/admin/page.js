import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { buildAnalytics, shiftDay, today } from '@/lib/analytics';
import { getAdsInsights } from '@/lib/metaAds';

export const dynamic = 'force-dynamic';

const CSS = [
  '*{box-sizing:border-box}',
  'body{margin:0;background:#f6f6f8;color:#16161a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5}',
  '.wrap{max-width:980px;margin:0 auto;padding:16px 14px 60px}',
  '.top{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between;margin-bottom:12px}',
  '.top h1{font-size:20px;margin:0}',
  '.who{font-size:13px;color:#71717a}',
  '.tabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}',
  '.tab{padding:8px 14px;border-radius:999px;background:#fff;border:1px solid #e4e4e7;color:#3f3f46;text-decoration:none;font-size:14px}',
  '.tab.on{background:#16161a;color:#fff;border-color:#16161a}',
  '.dates{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid #ececf0;border-radius:14px;padding:10px 12px;margin-bottom:12px}',
  '.dates input{font:inherit;padding:6px 8px;border:1px solid #e4e4e7;border-radius:8px;background:#fff;color:inherit}',
  '.dates select{font:inherit;padding:6px 8px;border:1px solid #e4e4e7;border-radius:8px;background:#fff;color:inherit}',
  '.dates button{font:inherit;padding:7px 14px;border:none;border-radius:8px;background:#16161a;color:#fff;cursor:pointer}',
  '.dates .quick{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}',
  '.dates .quick a{font-size:13px;color:#6d28d9;text-decoration:none;padding:4px 6px}',
  '.card{background:#fff;border:1px solid #ececf0;border-radius:14px;padding:14px;margin-bottom:12px}',
  '.card h2{font-size:15px;margin:0 0 12px}',
  '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}',
  '.kpi{background:#fafafa;border-radius:10px;padding:10px 12px}',
  '.kpi b{display:block;font-size:19px;line-height:1.2}',
  '.kpi span{font-size:12px;color:#71717a}',
  '.step{margin-bottom:10px}',
  '.step .line{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px}',
  '.step .bar{height:10px;border-radius:6px;background:#ececf0;overflow:hidden}',
  '.step .bar i{display:block;height:100%;background:#6d28d9}',
  '.muted{color:#71717a;font-size:13px}',
  '.topshare{display:inline-block;min-width:52px;text-align:right;margin-left:8px}',
  'table{width:100%;border-collapse:collapse;font-size:13px}',
  'th,td{text-align:right;padding:6px 4px;border-bottom:1px solid #f1f1f4;white-space:nowrap}',
  'th:first-child,td:first-child{text-align:left;white-space:normal}',
  'th{color:#71717a;font-weight:500}',
  '.scroll{overflow-x:auto}',
  '.warn{background:#fff7ed;border-color:#fed7aa}',
  '.bad{color:#b91c1c}',
  '.ok{color:#15803d}'
].join('');

const TABS = [
  { key: 'meta', label: 'Перформанс на Мете', owner: true },
  { key: 'funnel', label: 'Воронка', owner: false },
  { key: 'work', label: 'Заявки и уроки', owner: false },
  { key: 'money', label: 'Финансы', owner: true }
];

function money(cents) {
  return Math.round(Number(cents || 0) / 100).toLocaleString('ru-RU') + ' EUR';
}

function euro(value) {
  return Math.round(Number(value || 0)).toLocaleString('ru-RU') + ' EUR';
}

function price(total, count) {
  if (total === null || !count) return '—';

  return euro(total / count);
}

function short(date) {
  return date.slice(8) + '.' + date.slice(5, 7);
}

function link(tab, from, to, source) {
  return '/admin?tab=' + tab + '&from=' + from + '&to=' + to
    + (source && source !== 'all' ? '&source=' + source : '');
}

function monthEdges(back) {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0));

  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export default async function AdminPage({ searchParams }) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');

  const owner = session.role === 'owner';
  const params = await searchParams;
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const to = valid(params?.to) ? params.to : today();
  const from = valid(params?.from) ? params.from : shiftDay(to, -29);
  const visible = TABS.filter(tab => owner || !tab.owner);
  const tab = visible.some(item => item.key === params?.tab) ? params.tab : visible[0].key;

  const source = ['meta', 'organic'].includes(params?.source) ? params.source : 'all';
  const data = await buildAnalytics({ from, to, source });
  const needAds = owner && (tab === 'meta' || tab === 'funnel');
  const ads = needAds ? await getAdsInsights({ from, to }) : null;

  // Верхняя точка воронки — клик по рекламе, если кабинет доступен. Иначе
  // открытие страницы: выше этого мы ничего не видим.
  const steps = (ads && ads.ok ? [{ key: 'clicks', label: 'Клик по рекламе', value: ads.clicks }] : [])
    .concat(data.funnel);
  const head = steps[0] ? steps[0].value || 1 : 1;
  const chain = steps.map((step, index) => ({
    ...step,
    prevPct: index === 0 ? null : (steps[index - 1].value ? Math.round((step.value / steps[index - 1].value) * 1000) / 10 : null),
    topPct: index === 0 ? 100 : Math.round((step.value / head) * 1000) / 10
  }));
  const spend = ads && ads.ok ? ads.spend : null;
  const thisMonth = monthEdges(0);
  const prevMonth = monthEdges(1);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        <div className="top">
          <h1>SAY YES</h1>
          <div className="who">@{session.username} · {owner ? 'управляющий' : 'менеджер'}</div>
        </div>

        <div className="tabs">
          {visible.map(item => (
            <a key={item.key} className={'tab' + (item.key === tab ? ' on' : '')} href={link(item.key, from, to, source)}>
              {item.label}
            </a>
          ))}
        </div>

        <form className="dates" method="get">
          <input type="hidden" name="tab" value={tab} />
          <label className="muted">с</label>
          <input type="date" name="from" defaultValue={from} />
          <label className="muted">по</label>
          <input type="date" name="to" defaultValue={to} />
          {tab === 'money' && (
            <select name="source" defaultValue={source}>
              <option value="all">все источники</option>
              <option value="meta">воронка (Мета)</option>
              <option value="organic">органика</option>
            </select>
          )}
          <button type="submit">Показать</button>
          <span className="quick">
            <a href={link(tab, shiftDay(today(), -6), today(), source)}>7 дней</a>
            <a href={link(tab, shiftDay(today(), -29), today(), source)}>30 дней</a>
            <a href={link(tab, thisMonth.from, thisMonth.to, source)}>этот месяц</a>
            <a href={link(tab, prevMonth.from, prevMonth.to, source)}>прошлый</a>
          </span>
        </form>

        {tab === 'meta' && (
          <>
            {ads && !ads.ok && (
              <div className="card warn">
                <h2>Кабинет недоступен</h2>
                <p className="muted">{ads.reason}</p>
              </div>
            )}

            {ads && ads.ok && (
              <>
                <div className="card">
                  <h2>Реклама за период</h2>
                  <div className="kpis">
                    <div className="kpi"><b>{euro(ads.spend)}</b><span>расход</span></div>
                    <div className="kpi"><b>{ads.impressions.toLocaleString('ru-RU')}</b><span>показов</span></div>
                    <div className="kpi"><b>{ads.clicks.toLocaleString('ru-RU')}</b><span>кликов</span></div>
                    <div className="kpi"><b>{ads.ctr === null ? '—' : ads.ctr + '%'}</b><span>CTR</span></div>
                    <div className="kpi"><b>{ads.cpc === null ? '—' : ads.cpc + ' EUR'}</b><span>цена клика</span></div>
                    <div className="kpi"><b>{ads.cpm === null ? '—' : ads.cpm + ' EUR'}</b><span>CPM</span></div>
                  </div>
                </div>

                <div className="card">
                  <h2>Что стоят наши цифры</h2>
                  <div className="kpis">
                    <div className="kpi"><b>{price(spend, data.totals.bookings)}</b><span>заявка ({data.totals.bookings} в базе)</span></div>
                    <div className="kpi"><b>{price(spend, data.totals.attended)}</b><span>дошедший ({data.totals.attended})</span></div>
                    <div className="kpi"><b>{price(spend, data.totals.paid)}</b><span>оплата ({data.totals.paid})</span></div>
                    <div className="kpi"><b>{spend ? (data.money.bySource.meta.revenue / 100 / spend).toFixed(2) : '—'}</b><span>окупаемость воронки, EUR на EUR</span></div>
                    <div className="kpi"><b>{ads.leads}</b><span>лидов по данным Меты</span></div>
                    <div className="kpi"><b>{money(data.money.bySource.meta.revenue)}</b><span>выручка с воронки</span></div>
                  </div>
                  <p className="muted">
                    Лиды Меты и заявки в базе почти никогда не совпадают: пиксель считает браузеры,
                    база — людей. Расхождение в полтора-два раза нормально, в разы — повод смотреть события.
                  </p>
                </div>

                <div className="card">
                  <h2>Кампании</h2>
                  <div className="scroll">
                    <table>
                      <thead><tr><th>Кампания</th><th>Расход</th><th>Клики</th><th>Лиды</th><th>Цена лида</th></tr></thead>
                      <tbody>
                        {ads.campaigns.map(row => (
                          <tr key={row.name}>
                            <td>{row.name}</td>
                            <td>{euro(row.spend)}</td>
                            <td>{row.clicks}</td>
                            <td>{row.leads}</td>
                            <td>{row.leads ? euro(row.spend / row.leads) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="card">
                  <h2>По дням</h2>
                  <div className="scroll">
                    <table>
                      <thead><tr><th>Дата</th><th>Расход</th><th>Клики</th><th>Лиды Меты</th><th>Заявки в базе</th></tr></thead>
                      <tbody>
                        {data.daily.slice().reverse().map(row => {
                          const day = ads.byDay[row.date];

                          if (!day && !row.bookings) return null;

                          return (
                            <tr key={row.date}>
                              <td>{short(row.date)}</td>
                              <td>{day ? euro(day.spend) : '—'}</td>
                              <td>{day ? day.clicks : '—'}</td>
                              <td>{day ? day.leads : '—'}</td>
                              <td><b>{row.bookings}</b></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'funnel' && (
          <>
            <div className="card">
              <h2>Путь от клика до оплаты</h2>
              {chain.map(step => (
                <div className="step" key={step.key}>
                  <div className="line">
                    <span>{step.label}</span>
                    <span>
                      <b>{step.value}</b>
                      <span className="muted">
                        {step.prevPct === null ? '' : ' · ' + step.prevPct + '% с прошлого шага'}
                      </span>
                      <b className="topshare">{step.topPct}%</b>
                    </span>
                  </div>
                  <div className="bar"><i style={{ width: Math.max(1, Math.round((step.value / head) * 100)) + '%' }} /></div>
                </div>
              ))}
              <p className="muted">
                Жирный процент справа — доля от самой верхней точки: сколько людей из ста дошло
                до этого шага. Серый — переход с предыдущего шага.
                {ads && ads.ok ? ' Верх воронки — клики по рекламе.' : ' Кабинет недоступен, верх воронки — открытия страницы.'}
              </p>
              {data.totals.visits < data.totals.quiz && (
                <p className="muted bad">
                  Открытия страницы до 12 сентября не считались вообще — счётчик стоял только
                  на переходах между экранами. Поэтому в старых периодах первый шаг занижен.
                </p>
              )}
            </div>

            <div className="card">
              <h2>Экран за экраном</h2>
              <div className="scroll">
                <table>
                  <thead><tr><th>Экран</th><th>Людей</th><th>От первого</th><th>С прошлого</th></tr></thead>
                  <tbody>
                    {data.screens.map((row, index) => {
                      const first = data.screens[0].value;
                      const prev = index === 0 ? null : data.screens[index - 1].value;

                      if (!row.value && index > 2) return null;

                      return (
                        <tr key={row.key}>
                          <td>{row.label}</td>
                          <td><b>{row.value}</b></td>
                          <td>{first ? Math.round((row.value / first) * 1000) / 10 + '%' : '—'}</td>
                          <td>{prev ? Math.round((row.value / prev) * 1000) / 10 + '%' : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Каждая строка — экран, который человек реально увидел. Здесь видно, какой именно
                экран съедает людей: до 12 сентября первый экран не считался, в старых периодах
                проценты от него смысла не имеют.
              </p>
            </div>

            <div className="card">
              <h2>Шаги воронки по дням</h2>
              <div className="scroll">
                <table>
                  <thead>
                    <tr><th>Дата</th><th>Открыли</th><th>Квиз</th><th>Контакты</th><th>Время</th><th>Заявки</th></tr>
                  </thead>
                  <tbody>
                    {data.daily.filter(row => row.visits || row.bookings).reverse().map(row => (
                      <tr key={row.date}>
                        <td>{short(row.date)}</td>
                        <td>{row.visits}</td>
                        <td>{row.quiz}</td>
                        <td>{row.contacts}</td>
                        <td>{row.slots}</td>
                        <td><b>{row.bookings}</b></td>
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
          </>
        )}

        {tab === 'work' && (
          <>
            <div className="card">
              <h2>Итоги периода</h2>
              <div className="kpis">
                <div className="kpi"><b>{data.totals.bookings}</b><span>заявок</span></div>
                <div className="kpi"><b>{data.totals.lessons}</b><span>уроков в расписании</span></div>
                <div className="kpi"><b className="ok">{data.totals.attended}</b><span>пришли</span></div>
                <div className="kpi"><b>{data.totals.noshow}</b><span>не пришли</span></div>
                <div className="kpi"><b className={data.totals.unmarked ? 'bad' : ''}>{data.totals.unmarked}</b><span>без отметки</span></div>
                <div className="kpi"><b>{data.totals.cancelled}</b><span>отмен</span></div>
                {owner && <div className="kpi"><b>{money(data.money.revenue)}</b><span>выручка, {data.money.payments} оплат</span></div>}
                {owner && <div className="kpi"><b>{data.money.direct} из {data.money.payments}</b><span>прямых через Stripe</span></div>}
              </div>
            </div>

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
                        <td>{short(row.date)}</td>
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
              <p className="muted">Эти счётчики — по всей базе, а не только за выбранный период.</p>
            </div>
          </>
        )}

        {tab === 'money' && (
          <>
            <div className="card">
              <h2>Откуда деньги</h2>
              <div className="kpis">
                <div className="kpi">
                  <b>{money(data.money.bySource.meta.revenue)}</b>
                  <span>воронка, {data.money.bySource.meta.count} оплат</span>
                </div>
                <div className="kpi">
                  <b>{money(data.money.bySource.organic.revenue)}</b>
                  <span>органика, {data.money.bySource.organic.count} оплат</span>
                </div>
              </div>
              <p className="muted">
                Воронка — оплаты, привязанные к заявке: эти люди пришли с рекламы, и только они
                имеют отношение к её окупаемости. Органика — старые ученики, счета и переводы
                мимо воронки. Ниже всё считается по выбранному источнику
                {source === 'all' ? ' (сейчас — по обоим).' : source === 'meta' ? ' (сейчас — только воронка).' : ' (сейчас — только органика).'}
              </p>
            </div>

            <div className="card">
              <h2>Деньги за период</h2>
              <div className="kpis">
                <div className="kpi"><b>{money(data.money.revenue)}</b><span>выручка</span></div>
                <div className="kpi"><b>{data.money.payments}</b><span>оплат</span></div>
                <div className="kpi"><b>{money(data.money.averageCheck)}</b><span>средний чек</span></div>
                <div className="kpi"><b>{data.money.direct} из {data.money.payments}</b><span>прямых через Stripe</span></div>
                <div className="kpi"><b>{money(data.money.monthRevenue)}</b><span>за текущий месяц, {data.money.monthPayments} шт.</span></div>
                <div className="kpi"><b>{data.money.attendedToPaid === null ? '—' : data.money.attendedToPaid + '%'}</b><span>дошли и оплатили</span></div>
              </div>
              <p className="muted">
                Прямая оплата — по ссылке из бота: она видна в Stripe и уходит в рекламу как Purchase.
                «Мимо кассы» проводит менеджер руками, и в аналитике рекламы её нет.
              </p>
            </div>

            <div className="card">
              <h2>Когда платят</h2>
              <div className="kpis">
                <div className="kpi">
                  <b>{data.money.medianHoursToPay === null ? '—' : data.money.medianHoursToPay + ' ч'}</b>
                  <span>медиана от урока до оплаты</span>
                </div>
                <div className="kpi"><b>{data.money.paidWithinDay}</b><span>оплат в первые сутки после урока</span></div>
              </div>
              <p className="muted">
                Спецпредложение живёт трое суток. Если медиана уезжает к концу окна, ссылку отправляют поздно.
              </p>
            </div>

            {data.money.byPack.length > 0 && (
              <div className="card">
                <h2>Что покупают</h2>
                <div className="scroll">
                  <table>
                    <thead><tr><th>Пакет</th><th>Оплат</th><th>Сумма</th><th>Средний чек</th></tr></thead>
                    <tbody>
                      {data.money.byPack.map(row => (
                        <tr key={row.label}>
                          <td>{row.label}</td>
                          <td>{row.count}</td>
                          <td>{money(row.amount)}</td>
                          <td>{money(row.amount / row.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="card">
              <h2>Деньги по дням</h2>
              <div className="scroll">
                <table>
                  <thead><tr><th>Дата</th><th>Оплат</th><th>Сумма</th></tr></thead>
                  <tbody>
                    {data.money.byDay.filter(row => row.count > 0).reverse().map(row => (
                      <tr key={row.date}>
                        <td>{short(row.date)}</td>
                        <td>{row.count}</td>
                        <td><b>{money(row.amount)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <h2>Все оплаты периода</h2>
              <div className="scroll">
                <table>
                  <thead><tr><th>Когда</th><th>Пакет</th><th>Сумма</th><th>Как</th><th>Заявка</th></tr></thead>
                  <tbody>
                    {data.money.list.map(row => (
                      <tr key={row.at + (row.pi || row.bookingId || '')}>
                        <td>{String(row.at).slice(8, 10)}.{String(row.at).slice(5, 7)}</td>
                        <td>{row.label || 'пакет'}</td>
                        <td>{money(row.amount)}</td>
                        <td>{row.via || 'Stripe'}</td>
                        <td>{row.bookingId || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.money.list.length === 0 && <p className="muted">За этот период оплат не было.</p>}
            </div>
          </>
        )}

        <p className="muted">
          Период: {data.range.from} — {data.range.to} ({data.range.days} дн.). Границы суток — в поясе
          расписания (UTC+3), как в боте. Архивные и тестовые заявки в расчёт не идут.
        </p>
      </div>
    </>
  );
}
