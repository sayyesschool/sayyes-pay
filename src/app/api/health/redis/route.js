import { NextResponse } from 'next/server';

// Диагностика хранилища. Нужна потому, что kvGet и kvKeys ловят любую ошибку
// и возвращают пусто: сбой подключения выглядит ровно как пустая база, и понять,
// «всё стёрлось» или «нас не пускают», по обычным экранам невозможно.
//
// Наружу отдаём только код ответа и число ключей. Ни адреса, ни токена, ни данных.
export async function GET() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return NextResponse.json({
      ok: false,
      verdict: 'Переменные хранилища не заданы',
      hasUrl: Boolean(url),
      hasToken: Boolean(token)
    });
  }

  async function probe(path) {
    try {
      const resp = await fetch(url + path, {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store'
      });
      const text = await resp.text();
      let parsed = null;

      try { parsed = JSON.parse(text); } catch (e) { parsed = null; }

      return {
        status: resp.status,
        ok: resp.ok,
        error: parsed && parsed.error ? String(parsed.error).slice(0, 200) : null,
        result: parsed && parsed.result !== undefined ? parsed.result : null,
        raw: parsed ? null : text.slice(0, 200)
      };
    } catch (e) {
      return { status: 0, ok: false, error: String(e.message || e).slice(0, 200) };
    }
  }

  const size = await probe('/dbsize');
  const keys = await probe('/keys/booking:*');
  const count = Array.isArray(keys.result) ? keys.result.length : null;

  let verdict = 'Непонятно, смотрите поля ниже';

  if (size.status === 401 || size.status === 403) verdict = 'Хранилище не пускает: токен недействителен или отозван';
  else if (size.status === 429) verdict = 'Хранилище режет запросы: превышен лимит тарифа';
  else if (size.status === 0) verdict = 'До хранилища не достучались: сети нет или адрес не отвечает';
  else if (size.ok && Number(size.result) === 0) verdict = 'Подключение есть, база ПУСТАЯ';
  else if (size.ok) verdict = 'Подключение есть, ключей в базе: ' + size.result;

  return NextResponse.json({
    ok: Boolean(size.ok),
    verdict,
    host: String(url).replace(/^https?:\/\//, '').split('.')[0].slice(0, 6) + '…',
    dbsize: size,
    bookingKeys: count,
    keysProbe: { status: keys.status, error: keys.error }
  }, { headers: { 'Access-Control-Allow-Origin': '*' } });
}
