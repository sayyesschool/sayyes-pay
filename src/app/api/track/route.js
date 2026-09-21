import { NextResponse } from 'next/server';
import { kvSet, kvGet, kvSeenFirstTime } from '@/lib/redis';

// Сутки считаем в базовом поясе расписания (UTC+3) — в нём живут слоты,
// сводка бота и аналитика админки. Раньше здесь стояла дата UTC, и всё,
// что случалось с 00:00 до 03:00 МСК, ложилось во вчерашний день:
// экраны воронки и заявки разъезжались на ровном месте.
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;

// Источник приходит из воронки (VISIT_SOURCE в learn_easy.html). Чистим его
// сами: в счётчик попадает только то, что мы сами и записали бы, — иначе любой
// желающий сможет насыпать в отчёт произвольных ключей.
function cleanSource(value) {
  const src = String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);

  return src || 'unknown';
}

export async function POST(request) {
  try {
    const { step, src, ad, vid } = await request.json();

    if (!step) return NextResponse.json({ error: 'Missing step' }, { status: 400 });

    let name = String(step).slice(0, 40);
    const day = new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10);

    // Открытие страницы и человек — не одно и то же. За 17–21 сентября Мета
    // насчитала 441 клик, а счётчик — 597 открытий: один человек открывает
    // ссылку во встроенном браузере Instagram, потом жмёт «открыть в Safari»,
    // перезагружает, возвращается назад. Метка в самой странице этого не ловит:
    // в другом браузере своё хранилище. Зато fbclid переезжает вместе со ссылкой,
    // поэтому считаем по нему — а у заходов без него берём метку из localStorage.
    //
    // Повторный заход не пропадает: он пишется как landing_repeat, и видно,
    // сколько раз люди возвращались.
    if (name === '1' && vid) {
      const visitor = String(vid).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64);

      if (visitor) {
        const first = await kvSeenFirstTime('track:vis:' + day, visitor, 60 * 60 * 48);

        if (!first) name = '1r';
      }
    }
    const key = 'track:' + day;
    const data = await kvGet(key) || {};

    // Общий счётчик остаётся прежним: на него смотрят админка и старые отчёты.
    // Разрез по источнику пишем рядом отдельными ключами вида landing|meta.
    data[name] = (data[name] || 0) + 1;

    const bucket = name + '|' + cleanSource(src);

    data[bucket] = (data[bucket] || 0) + 1;

    // Разрез по объявлению — третий набор ключей, через собаку: landing@120253052490740019.
    // Появляется только у тех объявлений, где в параметрах ссылки есть макрос ad_id.
    const adId = String(ad || '').replace(/[^0-9]/g, '').slice(0, 20);

    if (adId) {
      const adBucket = name + '@' + adId;

      data[adBucket] = (data[adBucket] || 0) + 1;
    }

    await kvSet(key, data, 60 * 60 * 24 * 90);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Track error:', e);

    // Трекер никогда не должен ронять воронку: молча отвечаем ok.
    return NextResponse.json({ ok: true });
  }
}
