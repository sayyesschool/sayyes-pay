import { kvGet, kvKeys } from '@/lib/redis';

// Всё считаем в базовом поясе расписания (UTC+3) — том же, в котором живут
// слоты и команды бота. Иначе «сегодня» в админке и в /today разъезжаются.
const TZ_SHIFT = 3 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export function dayKey(value) {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();

  if (!ms || Number.isNaN(ms)) return null;

  return new Date(ms + TZ_SHIFT).toISOString().slice(0, 10);
}

export function today() {
  return dayKey(Date.now());
}

export function shiftDay(date, days) {
  return new Date(new Date(date + 'T00:00:00Z').getTime() + days * DAY).toISOString().slice(0, 10);
}

// Период задаётся датами: три кнопки «7 / 30 / 90» не отвечают на вопрос
// «что было с 1 по 14 сентября», а он возникает чаще всего.
export function dayList(from, to) {
  const out = [];
  let cursor = from;

  while (cursor <= to && out.length < 400) {
    out.push(cursor);
    cursor = shiftDay(cursor, 1);
  }

  return out;
}

// Урок начинается в базовом поясе: ключ слота хранится как YYYY-MM-DD_HH:MM.
export function slotStartMs(booking) {
  if (!booking || !booking.slot || booking.slot === 'no_time') return null;

  const [date, time] = String(booking.slot).split('_');
  const [h, m] = String(time || '').split(':').map(Number);
  const base = new Date(date + 'T00:00:00Z').getTime();

  if (!base || Number.isNaN(base) || Number.isNaN(h) || Number.isNaN(m)) return null;

  return base + ((h - 3) * 60 + m) * 60 * 1000;
}

export async function loadBookings() {
  const keys = await kvKeys('booking:*');
  const out = [];

  for (const key of keys) {
    const booking = await kvGet(key);

    // Архив — заявки до запуска рекламы, introTest — проверки спецпредложения.
    // И то и другое портит любую конверсию, поэтому в аналитику не берём.
    if (!booking || booking.archived || booking.introTest) continue;

    out.push(booking);
  }

  return out;
}

export async function loadPayments() {
  const keys = await kvKeys('payment:*');
  const out = [];

  for (const key of keys) {
    const rec = await kvGet(key);

    if (rec && rec.at) out.push(rec);
  }

  return out;
}

// Свой трекер пишет счётчики по экранам воронки: track:YYYY-MM-DD.
export async function loadTraffic(days) {
  const out = {};

  for (const date of days) {
    const rec = await kvGet('track:' + date);

    out[date] = rec && typeof rec === 'object' ? rec : {};
  }

  return out;
}

function pct(a, b) {
  if (!b) return null;

  return Math.round((a / b) * 1000) / 10;
}

function quizValue(booking, field) {
  const answers = booking.quizAnswers || {};

  return answers[field] || null;
}

export async function buildAnalytics({ from, to, source = 'all' } = {}) {
  const last = to || today();
  const first = from || shiftDay(last, -29);
  const dates = dayList(first, last);
  const [bookings, payments, traffic] = await Promise.all([
    loadBookings(),
    loadPayments(),
    loadTraffic(dates)
  ]);

  const inRange = date => Boolean(date) && date >= first && date <= last;

  // --- Заявки по дате заявки ---
  const daily = dates.map(date => ({
    date,
    visits: traffic[date].landing || 0,
    quiz: traffic[date].q_level || 0,
    contacts: traffic[date].contacts || 0,
    slots: traffic[date].time_slots || 0,
    bookings: 0,
    confirmed: 0,
    cancelled: 0
  }));
  const byDate = Object.fromEntries(daily.map(row => [row.date, row]));

  for (const booking of bookings) {
    const date = dayKey(booking.createdAt);
    const row = byDate[date];

    if (!row) continue;

    row.bookings++;
    if (booking.confirmed) row.confirmed++;
    if (booking.status === 'cancelled') row.cancelled++;
  }

  // --- Уроки по дате урока ---
  const lessonsByDate = Object.fromEntries(dates.map(date => [date, {
    date, lessons: 0, attended: 0, noshow: 0, unmarked: 0, paid: 0, revenue: 0
  }]));

  for (const booking of bookings) {
    const start = slotStartMs(booking);
    const date = start ? dayKey(start) : null;
    const row = date ? lessonsByDate[date] : null;

    if (!row || booking.status === 'cancelled') continue;

    row.lessons++;

    if (booking.attended === true) row.attended++;
    else if (booking.attended === false) row.noshow++;
    else if (start < Date.now()) row.unmarked++;

    if (booking.paid) {
      row.paid++;
      row.revenue += Number(booking.paidAmount || 0);
    }
  }

  const lessons = dates.map(date => lessonsByDate[date]);

  // --- Итоги и переходы ---
  const sum = (rows, field) => rows.reduce((acc, row) => acc + (row[field] || 0), 0);
  const totals = {
    visits: sum(daily, 'visits'),
    quiz: sum(daily, 'quiz'),
    contacts: sum(daily, 'contacts'),
    slots: sum(daily, 'slots'),
    bookings: sum(daily, 'bookings'),
    confirmed: sum(daily, 'confirmed'),
    cancelled: sum(daily, 'cancelled'),
    lessons: sum(lessons, 'lessons'),
    attended: sum(lessons, 'attended'),
    noshow: sum(lessons, 'noshow'),
    unmarked: sum(lessons, 'unmarked'),
    paid: sum(lessons, 'paid'),
    revenue: sum(lessons, 'revenue')
  };

  const funnel = [
    { key: 'visits', label: 'Открыли воронку', value: totals.visits, of: null },
    { key: 'quiz', label: 'Начали квиз', value: totals.quiz, of: pct(totals.quiz, totals.visits) },
    { key: 'contacts', label: 'Дошли до контактов', value: totals.contacts, of: pct(totals.contacts, totals.quiz) },
    { key: 'bookings', label: 'Записались', value: totals.bookings, of: pct(totals.bookings, totals.contacts) },
    { key: 'confirmed', label: 'Подтвердили', value: totals.confirmed, of: pct(totals.confirmed, totals.bookings) },
    { key: 'attended', label: 'Пришли на урок', value: totals.attended, of: pct(totals.attended, totals.lessons) },
    { key: 'paid', label: 'Оплатили', value: totals.paid, of: pct(totals.paid, totals.attended) }
  ];

  // --- Сегменты из квиза ---
  const fields = ['Уровень', 'Цель', 'Страна', 'Формат', 'Возраст'];
  const segments = {};

  for (const field of fields) {
    const map = {};

    for (const booking of bookings) {
      const date = dayKey(booking.createdAt);

      if (!inRange(date)) continue;

      const value = quizValue(booking, field);

      if (!value) continue;

      const cell = map[value] || (map[value] = { value, bookings: 0, attended: 0, paid: 0 });

      cell.bookings++;
      if (booking.attended === true) cell.attended++;
      if (booking.paid) cell.paid++;
    }

    segments[field] = Object.values(map)
      .map(cell => ({
        ...cell,
        attendedPct: pct(cell.attended, cell.bookings),
        paidPct: pct(cell.paid, cell.attended)
      }))
      .sort((a, b) => b.bookings - a.bookings);
  }

  // --- Деньги ---
  // Источник оплаты: если платёж привязан к заявке, человек пришёл из воронки,
  // то есть с рекламы. Всё остальное — школа: старые ученики, счета, переводы
  // мимо воронки. Смешивать их в одной выручке бессмысленно: реклама окупается
  // только первыми, а вторые растут сами по себе.
  const sourceOf = rec => (rec.bookingId ? 'meta' : 'organic');
  const allRows = payments
    .filter(rec => inRange(dayKey(rec.at)))
    .map(rec => ({ ...rec, source: sourceOf(rec) }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const bySource = {
    meta: { count: 0, revenue: 0 },
    organic: { count: 0, revenue: 0 }
  };

  for (const rec of allRows) {
    const cell = bySource[rec.source];

    cell.count++;
    cell.revenue += Number(rec.amount || 0);
  }

  const paymentRows = source === 'all' ? allRows : allRows.filter(rec => rec.source === source);
  const revenue = paymentRows.reduce((acc, rec) => acc + Number(rec.amount || 0), 0);
  const direct = paymentRows.filter(rec => (rec.via || 'Stripe') !== 'Мимо кассы').length;

  // Деньги по дням и по пакетам: без этого не видно, что именно покупают
  // и в какие дни приходят деньги, а один общий итог этого не показывает.
  const byDayMap = Object.fromEntries(dates.map(date => [date, { date, count: 0, amount: 0 }]));
  const byPackMap = {};

  for (const rec of paymentRows) {
    const date = dayKey(rec.at);
    const row = byDayMap[date];

    if (row) {
      row.count++;
      row.amount += Number(rec.amount || 0);
    }

    const label = rec.label || 'без пакета';
    const pack = byPackMap[label] || (byPackMap[label] = { label, count: 0, amount: 0 });

    pack.count++;
    pack.amount += Number(rec.amount || 0);
  }

  // Текущий календарный месяц считаем всегда, независимо от выбранного периода:
  // это тот самый вопрос «сколько мы уже заработали в этом месяце».
  const monthPrefix = today().slice(0, 7);
  const monthRows = payments
    .filter(rec => String(dayKey(rec.at) || '').startsWith(monthPrefix))
    .filter(rec => source === 'all' || sourceOf(rec) === source);

  // Сколько проходит от урока до оплаты — окно спецпредложения три дня,
  // и полезно видеть, попадают ли люди в первые часы или тянут до конца.
  const paidBookings = bookings.filter(booking => booking.paid && booking.paidAt && slotStartMs(booking));
  const gaps = paidBookings
    .map(booking => (new Date(booking.paidAt).getTime() - slotStartMs(booking)) / (60 * 60 * 1000))
    .filter(hours => hours >= 0 && hours < 24 * 30)
    .sort((a, b) => a - b);

  const money = {
    source,
    bySource,
    payments: paymentRows.length,
    revenue,
    direct,
    directPct: pct(direct, paymentRows.length),
    averageCheck: paymentRows.length ? Math.round(revenue / paymentRows.length) : 0,
    list: paymentRows.slice(0, 40),
    byDay: dates.map(date => byDayMap[date]),
    byPack: Object.values(byPackMap).sort((a, b) => b.amount - a.amount),
    monthRevenue: monthRows.reduce((acc, rec) => acc + Number(rec.amount || 0), 0),
    monthPayments: monthRows.length,
    attendedToPaid: pct(totals.paid, totals.attended),
    medianHoursToPay: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)] * 10) / 10 : null,
    paidWithinDay: gaps.filter(hours => hours <= 24).length
  };

  // --- Здоровье данных ---
  const now = Date.now();
  const health = {
    unmarkedOld: bookings.filter(booking => {
      const start = slotStartMs(booking);

      return start && start < now - DAY && booking.status !== 'cancelled'
        && (booking.attended === undefined || booking.attended === null);
    }).length,
    noContact: bookings.filter(booking => !booking.email && !booking.telegram).length,
    noEmail: bookings.filter(booking => !booking.email).length,
    noChat: bookings.filter(booking => !booking.chatId).length,
    reviveQueue: bookings.filter(booking => booking.attended === false
      && !booking.reviveStopped && (booking.reviveStep || 0) < 3).length,
    pending: bookings.filter(booking => (!booking.slot || booking.slot === 'no_time')
      && booking.status !== 'cancelled').length
  };

  // Экран за экраном: общая воронка показывает, что люди не доходят,
  // но не где именно. Между первым экраном и первым вопросом квиза стоят
  // два отсекающих экрана, и без разбивки их вклад не виден.
  const SCREENS = [
    ['landing', 'Первый экран'],
    ['language', 'Вопрос про русский язык'],
    ['russian_only', 'Ответили «не подходит»'],
    ['country', 'Страна'],
    ['q_level', 'Уровень'],
    ['q_goal', 'Цель'],
    ['social_proof', 'Отзывы'],
    ['q_time', 'Время в неделю'],
    ['q_format', 'Формат'],
    ['q_readiness', 'Готовность'],
    ['progress_plan', 'План прогресса'],
    ['q_age', 'Возраст'],
    ['differentiation', 'Чем отличаемся'],
    ['value_reinforcement', 'Что на уроке'],
    ['contacts', 'Контакты'],
    ['time_slots', 'Выбор времени'],
    ['confirmation', 'Подтверждение']
  ];

  const screens = SCREENS.map(([key, label]) => ({
    key,
    label,
    value: dates.reduce((acc, date) => acc + (traffic[date][key] || 0), 0)
  }));

  return {
    range: { from: first, to: last, days: dates.length },
    daily,
    screens,
    lessons,
    totals,
    funnel,
    segments,
    money,
    health
  };
}
