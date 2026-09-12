// Общая оболочка админки: лента сверху с логотипом и выпадающими меню.
// Стили нарочно заданы от корня .syad и перебивают глобальные стили сайта —
// иначе школьная вёрстка растягивала пункты меню на всю ширину.

export const ADMIN_CSS = [
  '.syad *{box-sizing:border-box}',
  '.syad{background:#f6f6f8;color:#16161a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;min-height:100vh}',
  'body{margin:0;background:#f6f6f8}',
  '.syad a{color:#6d28d9;text-decoration:none}',
  '.syad .ribbon{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid #e7e7ec}',
  '.syad .ribbon .inner{max-width:1040px;margin:0 auto;padding:10px 14px;display:flex;align-items:center;gap:14px}',
  '.syad .brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:15px;color:#16161a;letter-spacing:.01em;white-space:nowrap}',
  '.syad .brand img{width:22px;height:22px;border-radius:6px;display:block}',
  '.syad .brand span{color:#6d28d9}',
  '.syad .menu{display:flex;align-items:center;gap:2px;flex:1;flex-wrap:wrap}',
  '.syad .menu > a,.syad .dd > summary{display:inline-flex;align-items:center;gap:6px;width:auto;padding:8px 12px;border-radius:10px;font-size:14px;color:#3f3f46;cursor:pointer;list-style:none;white-space:nowrap}',
  '.syad .menu > a:hover,.syad .dd > summary:hover{background:#f4f4f5}',
  '.syad .menu > a.on,.syad .dd.on > summary{background:#16161a;color:#fff}',
  '.syad .dd{position:relative}',
  '.syad .dd > summary::-webkit-details-marker{display:none}',
  '.syad .dd > summary::after{content:"";border:4px solid transparent;border-top-color:currentColor;margin-top:3px}',
  '.syad .dd[open] > summary{background:#f4f4f5;color:#16161a}',
  '.syad .dd .pop{position:absolute;top:calc(100% + 6px);left:0;min-width:210px;background:#fff;border:1px solid #e7e7ec;border-radius:12px;box-shadow:0 12px 28px rgba(16,16,26,.12);padding:6px;z-index:30}',
  '.syad .dd .pop a{display:block;padding:9px 10px;border-radius:8px;color:#3f3f46;font-size:14px}',
  '.syad .dd .pop a:hover{background:#f4f4f5}',
  '.syad .dd .pop a.on{background:#f3e8ff;color:#5b21b6;font-weight:600}',
  '.syad .who{font-size:12px;color:#a1a1aa;white-space:nowrap;margin-left:auto}',
  '.syad .wrap{max-width:1040px;margin:0 auto;padding:16px 14px 60px}',
  '.syad h1{font-size:20px;margin:0 0 14px}',
  '.syad .card{background:#fff;border:1px solid #ececf0;border-radius:14px;padding:14px;margin-bottom:12px}',
  '.syad .card h2{font-size:15px;margin:0 0 10px}',
  '.syad .card h3{font-size:15px;margin:16px 0 6px}',
  '.syad .card h4{font-size:14px;margin:14px 0 4px}',
  '.syad .card p{margin:0 0 10px}',
  '.syad .card ul{margin:0 0 10px;padding-left:20px}',
  '.syad .card li{margin-bottom:4px}',
  '.syad .muted{color:#71717a;font-size:13px}',
  '.syad .msg{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:12px;padding:10px 12px;margin-bottom:12px;font-size:14px}',
  '.syad .msg.err{background:#fef2f2;border-color:#fecaca;color:#991b1b}',
  '.syad .row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f1f4}',
  '.syad .row:last-child{border-bottom:none}',
  '.syad .row .when{font-size:13px;color:#71717a;white-space:nowrap}',
  '.syad .row .name{font-weight:600}',
  '.syad .row .sub{font-size:12px;color:#71717a}',
  '.syad .tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:#f4f4f5;color:#3f3f46;margin-right:4px}',
  '.syad .tag.ok{background:#dcfce7;color:#166534}',
  '.syad .tag.bad{background:#fee2e2;color:#991b1b}',
  '.syad .tag.wait{background:#fef9c3;color:#854d0e}',
  '.syad .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
  '.syad button,.syad .btn{font:inherit;padding:9px 14px;border-radius:10px;border:1px solid #e4e4e7;background:#fff;color:#16161a;cursor:pointer;display:inline-block;width:auto}',
  '.syad button.primary{background:#16161a;color:#fff;border-color:#16161a}',
  '.syad button.good{background:#15803d;color:#fff;border-color:#15803d}',
  '.syad button.warn{background:#b91c1c;color:#fff;border-color:#b91c1c}',
  '.syad input,.syad select,.syad textarea{font:inherit;padding:9px 10px;border:1px solid #e4e4e7;border-radius:10px;background:#fff;color:inherit;width:100%;max-width:520px}',
  '.syad textarea{min-height:90px;max-width:none}',
  '.syad .field{margin-bottom:10px}',
  '.syad .field label{display:block;font-size:12px;color:#71717a;margin-bottom:4px}',
  '.syad .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}',
  '.syad .kpi{background:#fafafa;border-radius:10px;padding:10px 12px}',
  '.syad .kpi b{display:block;font-size:19px;line-height:1.2}',
  '.syad .kpi span{font-size:12px;color:#71717a}',
  '.syad .step{margin-bottom:10px}',
  '.syad .step .line{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px}',
  '.syad .step .bar{height:10px;border-radius:6px;background:#ececf0;overflow:hidden}',
  '.syad .step .bar i{display:block;height:100%;background:#6d28d9}',
  '.syad .topshare{display:inline-block;min-width:52px;text-align:right;margin-left:8px}',
  '.syad .dates{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid #ececf0;border-radius:14px;padding:10px 12px;margin-bottom:12px}',
  '.syad .dates input,.syad .dates select{width:auto}',
  '.syad .dates .quick{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}',
  '.syad .dates .quick a{font-size:13px;padding:4px 6px}',
  '.syad table{width:100%;border-collapse:collapse;font-size:13px}',
  '.syad th,.syad td{text-align:right;padding:6px 4px;border-bottom:1px solid #f1f1f4;white-space:nowrap}',
  '.syad th:first-child,.syad td:first-child{text-align:left;white-space:normal}',
  '.syad th{color:#71717a;font-weight:500}',
  '.syad .scroll{overflow-x:auto}',
  '.syad .calhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:10px}',
  '.syad .calhead b{font-size:15px}',
  '.syad .calhead a{padding:4px 10px;border:1px solid #e4e4e7;border-radius:8px;color:#3f3f46;font-size:14px}',
  '.syad .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}',
  '.syad .cal .dow{font-size:11px;color:#a1a1aa;text-align:center;padding-bottom:2px}',
  '.syad .cal .day{display:block;min-height:52px;border:1px solid #f1f1f4;border-radius:10px;padding:5px 6px;color:#3f3f46;font-size:13px;background:#fff}',
  '.syad .cal .day.empty{border:none;background:transparent}',
  '.syad .cal .day.has{border-color:#ddd6fe;background:#faf5ff}',
  '.syad .cal .day.today{border-color:#16161a}',
  '.syad .cal .day.on{background:#16161a;color:#fff;border-color:#16161a}',
  '.syad .cal .day .n{font-weight:600}',
  '.syad .cal .day .c{display:block;font-size:11px;margin-top:2px;color:inherit;opacity:.75}',
  '.syad details.block{background:#fff;border:1px solid #ececf0;border-radius:14px;margin-bottom:12px;overflow:hidden}',
  '.syad details.block > summary{padding:13px 14px;font-weight:600;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px}',
  '.syad details.block > summary::-webkit-details-marker{display:none}',
  '.syad details.block > summary::after{content:"▾";color:#a1a1aa;font-size:12px}',
  '.syad details.block[open] > summary{border-bottom:1px solid #f1f1f4}',
  '.syad details.block .body{padding:0 14px 12px}',
  '.syad details.block .count{font-weight:500;color:#71717a;font-size:13px}',
  '.syad .sub-h{font-size:13px;color:#71717a;margin:12px 0 2px}',
  '.syad details.sub{border:1px solid #f1f1f4;border-radius:10px;margin:8px 0}',
  '.syad details.sub > summary{padding:10px 12px;cursor:pointer;list-style:none;font-size:14px;display:flex;justify-content:space-between;gap:10px;align-items:center}',
  '.syad details.sub > summary::-webkit-details-marker{display:none}',
  '.syad details.sub > summary::after{content:"▾";color:#a1a1aa;font-size:12px}',
  '.syad details.sub[open] > summary{border-bottom:1px solid #f1f1f4;font-weight:600}',
  '.syad details.sub > *:not(summary){padding:0 12px}',
  '.syad details.sub .row:last-child{border-bottom:none}',
  '.syad .slots{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}',
  '.syad .slot{display:inline-block;padding:7px 11px;border:1px solid #e4e4e7;border-radius:9px;background:#fff;font-size:13px;cursor:pointer;width:auto}',
  '.syad button.slot:hover{background:#16161a;color:#fff;border-color:#16161a}',
  '.syad .slot.off{opacity:.45;background:#f4f4f5;text-decoration:line-through;cursor:default}',
  '.syad .slot.mine{background:#f3e8ff;border-color:#ddd6fe;color:#5b21b6;font-weight:600}',
  '.syad .thread{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}',
  '.syad .bubble{max-width:80%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.45}',
  '.syad .bubble.in{align-self:flex-start;background:#f4f4f5}',
  '.syad .bubble.out{align-self:flex-end;background:#f3e8ff;color:#3b0764}',
  '.syad .bubble .meta{display:block;font-size:11px;color:#a1a1aa;margin-top:3px}',
  '.syad .warn{background:#fff7ed;border-color:#fed7aa}',
  '.syad .bad{color:#b91c1c}',
  '.syad .ok{color:#15803d}',
  '@media (max-width:640px){.syad .ribbon .inner{gap:8px;padding:8px 10px}.syad .who{display:none}.syad .menu > a,.syad .dd > summary{padding:7px 9px;font-size:13px}}'
].join('');

// Разделы ленты. У аналитики свои вкладки — они уезжают в выпадающее меню,
// чтобы верх не превращался в простыню из кнопок.
export const ANALYTICS_TABS = [
  { key: 'meta', label: 'Перформанс на Мете', owner: true },
  { key: 'funnel', label: 'Воронка', owner: false },
  { key: 'work', label: 'Заявки и уроки', owner: false },
  { key: 'money', label: 'Финансы', owner: true }
];

export function Shell({ session, active, activeTab, title, children }) {
  const owner = session.role === 'owner';
  const tabs = ANALYTICS_TABS.filter(tab => owner || !tab.owner);

  return (
    <div className="syad">
      <style dangerouslySetInnerHTML={{ __html: ADMIN_CSS }} />

      <div className="ribbon">
        <div className="inner">
          <a className="brand" href="/admin/work">
            <img src="/favicon-32x32.png" alt="" />
            SAY YES <span>admin</span>
          </a>

          <nav className="menu">
            <a className={active === 'work' ? 'on' : ''} href="/admin/work">Управление</a>

            <details className={'dd' + (active === 'admin' ? ' on' : '')}>
              <summary>Аналитика</summary>
              <div className="pop">
                {tabs.map(tab => (
                  <a
                    key={tab.key}
                    className={active === 'admin' && activeTab === tab.key ? 'on' : ''}
                    href={'/admin?tab=' + tab.key}
                  >
                    {tab.label}
                  </a>
                ))}
              </div>
            </details>

            <a className={active === 'wiki' ? 'on' : ''} href="/admin/wiki">База знаний</a>
            <a className={active === 'ask' ? 'on' : ''} href="/admin/ask">Спросить</a>
          </nav>

          <div className="who">@{session.username} · {owner ? 'управляющий' : 'менеджер'}</div>
        </div>
      </div>

      <div className="wrap">
        {title ? <h1>{title}</h1> : null}
        {children}
      </div>
    </div>
  );
}
