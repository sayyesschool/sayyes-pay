import { NextResponse } from 'next/server';

import { loadBookings, slotStartMs } from '@/lib/analytics';

// Доходимость мужчин и женщин. Отдаёт только счётчики: ни имён, ни почт.
//
// Вопрос, ради которого это написано: стоит ли вырезать мужчин из аудитории.
// В кабинете видно, что мужчины дают записи по той же цене, что и женщины,
// но кабинет не знает, кто пришёл на урок. Пол в базе не хранится, поэтому
// определяем его по имени, а спорные имена кладём в отдельную корзину,
// чтобы они не искажали обе стороны сравнения.
//
// Нас интересует не цена записи, а цена состоявшегося урока: расход по полу
// берётся из Меты и делится на attended отсюда.

export const dynamic = 'force-dynamic';

const DAY = 24 * 60 * 60 * 1000;

// Мужские имена на «а» и «я»: иначе они попали бы к женщинам.
const MALE_A = new Set([
  'никита', 'илья', 'данила', 'данило', 'гаврила', 'кузьма', 'фома', 'лука',
  'савва', 'паша', 'миша', 'гриша', 'лёша', 'леша', 'серёжа', 'сережа',
  'ваня', 'коля', 'витя', 'вова', 'дима', 'рома', 'лёва', 'лева', 'гоша',
  'тёма', 'тема', 'юра', 'толя', 'боря', 'сева', 'мустафа'
]);

// Имена без пола: по ним судить нельзя, в сравнение они не идут.
const AMBIGUOUS = new Set([
  'саша', 'женя', 'валя', 'слава', 'ника', 'алекс', 'alex', 'sasha', 'zhenya',
  'sam', 'jean', 'andrea', 'kim', 'jo', 'chris', 'robin', 'taylor', 'jordan'
]);

// Латиница по окончанию определяется плохо, поэтому частые имена перечислены.
const LATIN_FEMALE = new Set([
  'anna', 'maria', 'marie', 'elena', 'olga', 'irina', 'natalia', 'natalie',
  'julia', 'yulia', 'ekaterina', 'katerina', 'kate', 'katie', 'sofia', 'sophia',
  'daria', 'darya', 'alina', 'polina', 'diana', 'victoria', 'valeria', 'ksenia',
  'oksana', 'svetlana', 'tatiana', 'tatyana', 'liliya', 'lilia', 'nina', 'vera',
  'emily', 'sarah', 'laura', 'linda', 'hanna', 'hannah', 'aisha', 'fatima', 'leyla', 'layla'
]);

const LATIN_MALE = new Set([
  'ivan', 'sergey', 'sergei', 'alexey', 'aleksey', 'andrey', 'andrei', 'dmitry',
  'dmitri', 'mikhail', 'nikolay', 'pavel', 'roman', 'artem', 'artyom', 'egor',
  'igor', 'oleg', 'vadim', 'vladimir', 'maxim', 'denis', 'anton', 'kirill',
  'john', 'david', 'michael', 'daniel', 'peter', 'thomas', 'mark', 'paul',
  'ahmed', 'mohammed', 'muhammad', 'ali', 'omar', 'yusuf', 'mehmet', 'emre'
]);

export function guessGender(rawName) {
  const name = String(rawName || '').trim().toLowerCase();

  if (!name) return 'unknown';

  // Берём первое слово: в поле обычно имя, но иногда имя с фамилией.
  const first = name.split(/[\s,.]+/)[0].replace(/[^a-zа-яё-]/gi, '');

  if (!first || first.length < 2) return 'unknown';
  if (AMBIGUOUS.has(first)) return 'unknown';
  if (MALE_A.has(first)) return 'male';
  if (LATIN_FEMALE.has(first)) return 'female';
  if (LATIN_MALE.has(first)) return 'male';

  if (!/^[а-яё-]+$/.test(first)) return 'unknown';

  const last = first.slice(-1);

  if (last === 'а' || last === 'я') return 'female';
  // Мягкий знак ничего не решает: Игорь мужчина, Любовь женщина.
  if (last === 'ь') return 'unknown';

  return 'male';
}

function cell() {
  return { bookings: 0, attended: 0, noShow: 0, unmarked: 0, paid: 0, cancelled: 0 };
}

function finish(c) {
  const marked = c.attended + c.noShow;

  return {
    ...c,
    marked,
    // Доходимость от размеченных уроков: неразмеченные ничего не говорят.
    attendRate: marked ? Math.round((c.attended / marked) * 100) : null,
    // Доля от всех записей, включая неразмеченные: нижняя граница правды.
    attendRateOfAll: c.bookings ? Math.round((c.attended / c.bookings) * 100) : null
  };
}

export async function GET(request) {
  try {
    const daysParam = Number(request.nextUrl.searchParams.get('days'));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 90;
    const since = Date.now() - days * DAY;
    const now = Date.now();

    const bookings = await loadBookings();

    const buckets = { female: cell(), male: cell(), unknown: cell() };
    let skippedFuture = 0;

    for (const booking of bookings) {
      const start = slotStartMs(booking.slot);

      // Считаем только уроки, которые уже должны были состояться:
      // будущая запись ещё не может ни дойти, ни не дойти.
      if (!start || start > now) {
        skippedFuture++;
        continue;
      }

      if (start < since) continue;

      const bucket = buckets[guessGender(booking.name)];

      bucket.bookings++;

      if (booking.attended === true) bucket.attended++;
      else if (booking.attended === false) bucket.noShow++;
      else bucket.unmarked++;

      if (booking.paid) bucket.paid++;
      if (booking.status === 'cancelled') bucket.cancelled++;
    }

    return NextResponse.json({
      days,
      note: 'Пол определяется по имени, спорные имена лежат в unknown. Цена состоявшегося урока = расход по полу из Меты, делённый на attended.',
      skippedFuture,
      female: finish(buckets.female),
      male: finish(buckets.male),
      unknown: finish(buckets.unknown)
    });
  } catch (error) {
    return NextResponse.json({ error: String(error && error.message ? error.message : error) }, { status: 500 });
  }
}
