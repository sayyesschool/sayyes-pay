// Общая вёрстка админки: один источник стилей и шапки на все экраны.
// Всё серверное, без клиентского JS — страницы открываются мгновенно
// и работают с любого телефона.

export const ADMIN_CSS = [
  '*{box-sizing:border-box}',
  'body{margin:0;background:#f6f6f8;color:#16161a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5}',
  'a{color:#6d28d9}',
  '.wrap{max-width:980px;margin:0 auto;padding:14px 14px 60px}',
  '.top{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between;margin-bottom:10px}',
  '.top h1{font-size:19px;margin:0}',
  '.who{font-size:13px;color:#71717a}',
  '.nav{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}',
  '.nav a{padding:8px 14px;border-radius:999px;background:#fff;border:1px solid #e4e4e7;color:#3f3f46;text-decoration:none;font-size:14px}',
  '.nav a.on{background:#16161a;color:#fff;border-color:#16161a}',
  '.card{background:#fff;border:1px solid #ececf0;border-radius:14px;padding:14px;margin-bottom:12px}',
  '.card h2{font-size:15px;margin:0 0 10px}',
  '.muted{color:#71717a;font-size:13px}',
  '.msg{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:12px;padding:10px 12px;margin-bottom:12px;font-size:14px}',
  '.msg.err{background:#fef2f2;border-color:#fecaca;color:#991b1b}',
  '.row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f1f4}',
  '.row:last-child{border-bottom:none}',
  '.row .when{font-size:13px;color:#71717a;white-space:nowrap}',
  '.row .name{font-weight:600}',
  '.row .sub{font-size:12px;color:#71717a}',
  '.tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:#f4f4f5;color:#3f3f46;margin-right:4px}',
  '.tag.ok{background:#dcfce7;color:#166534}',
  '.tag.bad{background:#fee2e2;color:#991b1b}',
  '.tag.wait{background:#fef9c3;color:#854d0e}',
  '.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
  'button,.btn{font:inherit;padding:9px 14px;border-radius:10px;border:1px solid #e4e4e7;background:#fff;color:#16161a;cursor:pointer;text-decoration:none;display:inline-block}',
  'button.primary{background:#16161a;color:#fff;border-color:#16161a}',
  'button.good{background:#15803d;color:#fff;border-color:#15803d}',
  'button.warn{background:#b91c1c;color:#fff;border-color:#b91c1c}',
  'input,select,textarea{font:inherit;padding:9px 10px;border:1px solid #e4e4e7;border-radius:10px;background:#fff;color:inherit;width:100%;max-width:100%}',
  'textarea{min-height:90px}',
  '.field{margin-bottom:10px}',
  '.field label{display:block;font-size:12px;color:#71717a;margin-bottom:4px}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
  '.kv{font-size:13px;line-height:1.9}',
  '.kv b{color:#71717a;font-weight:500;display:inline-block;min-width:92px}',
  'table{width:100%;border-collapse:collapse;font-size:13px}',
  'th,td{text-align:right;padding:6px 4px;border-bottom:1px solid #f1f1f4;white-space:nowrap}',
  'th:first-child,td:first-child{text-align:left;white-space:normal}',
  'th{color:#71717a;font-weight:500}',
  '.scroll{overflow-x:auto}'
].join('');

export const SECTIONS = [
  { key: 'work', label: 'Работа', href: '/admin/work' },
  { key: 'admin', label: 'Аналитика', href: '/admin' },
  { key: 'wiki', label: 'База знаний', href: '/admin/wiki' },
  { key: 'ask', label: 'Спросить', href: '/admin/ask' }
];

export function statusTags(booking) {
  const tags = [];

  if (booking.status === 'cancelled') tags.push(['bad', 'отменена']);
  if (booking.attended === true) tags.push(['ok', 'пришёл']);
  if (booking.attended === false) tags.push(['bad', 'не пришёл']);
  if (booking.attended === undefined || booking.attended === null) tags.push(['wait', 'без отметки']);
  if (booking.confirmed) tags.push(['ok', 'подтвердил']);
  if (booking.paid) tags.push(['ok', 'оплачено']);
  if (!booking.chatId) tags.push(['', 'без бота']);

  return tags;
}

export function whenLabel(booking) {
  if (!booking.slot || booking.slot === 'no_time') return 'время не выбрано';

  const [date, time] = String(booking.slot).split('_');

  return date.slice(8) + '.' + date.slice(5, 7) + ' ' + time;
}
