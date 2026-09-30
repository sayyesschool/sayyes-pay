import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { loadLibrary, parseCsv, planRow, runBulk, ready, accountId, createStructure } from '@/lib/metaBulk';

export const dynamic = 'force-dynamic';
// 200 объявлений по два запроса к Мете в четыре потока укладываются в пару минут.
export const maxDuration = 300;

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page(title, body) {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(title) + '</title><style>body{font:14px system-ui,sans-serif;margin:16px;color:#1f1a2b}' +
    'table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}' +
    '.ok{color:#1f6f5c}.err{color:#b3261e}a{color:#5b2d9e}</style>' +
    '<h2>' + esc(title) + '</h2>' + body + '<p><a href="/admin/ads">Назад</a></p>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

export async function POST(request) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session || session.role !== 'owner') return page('Нет доступа', '<p>Только для управляющих.</p>');

  const problem = ready();
  if (problem) return page('Не настроено', '<p class="err">' + esc(problem) + '</p>');

  const form = await request.formData();
  const mode = String(form.get('mode') || 'check');

  if (mode === 'structure') {
    let spec;
    try { spec = JSON.parse(String(form.get('spec') || '')); } catch (e) {
      return page('Ошибка', '<p class="err">JSON не читается: ' + esc(e.message) + '</p>');
    }
    try {
      const r = await createStructure(spec);
      return page('Кампания создана на паузе',
        '<p>Кампания: ' + esc(r.campaignId) + '</p><table><tr><th>Группа</th><th>adset_id</th></tr>' +
        r.adsets.map(a => '<tr><td>' + esc(a.name) + '</td><td>' + esc(a.id) + '</td></tr>').join('') + '</table>' +
        '<p>Эти adset_id вставляйте в таблицу объявлений.</p>');
    } catch (e) {
      return page('Ошибка Меты', '<p class="err">' + esc(e.message) + '</p>');
    }
  }
  const file = form.get('file');
  const csv = file && typeof file === 'object' && file.size ? await file.text() : String(form.get('csv') || '');
  const rows = parseCsv(csv);

  if (!rows.length) return page('Пусто', '<p class="err">В таблице нет строк.</p>');

  const lib = await loadLibrary();
  const plans = rows.map(r => planRow(r, lib));
  const bad = plans.filter(p => p.errors.length);

  if (mode === 'check' || bad.length) {
    const body = '<p>Кабинет act_' + esc(accountId()) + '. Строк: ' + plans.length + ', с ошибками: ' + bad.length + '.' +
      (mode !== 'check' && bad.length ? ' <b class="err">Ничего не создано: сначала исправьте ошибки.</b>' : '') + '</p>' +
      '<table><tr><th>Строка</th><th>Название</th><th>Медиа</th><th>Кнопка</th><th>Проверка</th></tr>' +
      plans.map(p => '<tr><td>' + p.line + '</td><td>' + esc(p.name) + '</td><td>' +
        (p.postId ? 'публикация ' + esc(p.postId) : p.media.map(m => esc(m.name) + (m.found ? ' (' + m.found.type + ')' : '')).join('<br>')) +
        '</td><td>' + esc(p.cta) + '</td><td class="' + (p.errors.length ? 'err' : 'ok') + '">' +
        (p.errors.length ? esc(p.errors.join('; ')) : 'ок') + '</td></tr>').join('') + '</table>';
    return page(mode === 'check' ? 'Проверка' : 'Есть ошибки', body);
  }

  const started = Date.now();
  const results = await runBulk(plans);
  const done = results.filter(r => r.ok).length;
  const act = accountId();
  const body = '<p>Создано на паузе: ' + done + ' из ' + results.length + ' за ' + Math.round((Date.now() - started) / 1000) + ' с.</p>' +
    '<table><tr><th>Строка</th><th>Название</th><th>Результат</th></tr>' +
    results.map(r => '<tr><td>' + r.line + '</td><td>' + esc(r.name) + '</td><td class="' + (r.ok ? 'ok' : 'err') + '">' +
      (r.ok
        ? '<a target="_blank" href="https://adsmanager.facebook.com/adsmanager/manage/ads/edit?act=' + act + '&selected_ad_ids=' + r.adId + '">' + r.adId + '</a>' + (r.variant > 1 ? ' (вариант ' + r.variant + ')' : '')
        : esc(r.error)) + '</td></tr>').join('') + '</table>';

  return page('Готово', body);
}
