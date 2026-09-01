import { kvKeys, kvGet } from '@/lib/redis';

// Сводная панель: деньги из рекламного кабинета и воронка из бота в одной таблице.
// Именно того, чего нет в Ads Manager: он видит показы и события, но не видит,
// дошёл ли человек до урока.
//
// Адрес: /api/board?key=<ADMIN_API_KEY>. Там траты, поэтому под тем же ключом,
// что и /api/admin/bookings. Персональных данных на странице нет.
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAYS = 7;

function dayKey(value) {
    if (!value) return null;

    const time = new Date(value).getTime();

    if (Number.isNaN(time)) return null;

    return new Date(time + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function today() {
    return new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDay(key, delta) {
    const time = new Date(key + 'T00:00:00Z').getTime() + delta * 86400000;

    return new Date(time).toISOString().slice(0, 10);
}

function emptyDay() {
    return {
        bookings: 0,
        noTime: 0,
        cancelled: 0,
        released: 0,
        openedBot: 0,
        confirmed: 0,
        lessons: 0,
        attended: 0,
        noShow: 0,
        unmarked: 0,
        paid: 0
    };
}

async function readBot() {
    const keys = await kvKeys('booking:*');
    const days = {};
    const touch = key => {
        if (!days[key]) days[key] = emptyDay();

        return days[key];
    };

    for (const storageKey of keys) {
        const booking = await kvGet(storageKey);

        if (!booking || booking.archived) continue;

        const created = dayKey(booking.createdAt);
        const slotDay = booking.slot && booking.slot !== 'no_time'
            ? String(booking.slot).slice(0, 10)
            : null;

        if (created) {
            const day = touch(created);

            day.bookings++;
            if (!slotDay) day.noTime++;
            if (booking.status === 'cancelled') day.cancelled++;
            if (booking.releasedUnconfirmed) day.released++;
            if (booking.chatId) day.openedBot++;
            if (booking.confirmed) day.confirmed++;
        }

        if (slotDay && booking.status !== 'cancelled') {
            const day = touch(slotDay);

            day.lessons++;
            if (booking.attended === true) day.attended++;
            else if (booking.attended === false) day.noShow++;
            else day.unmarked++;
            if (booking.paid) day.paid++;
        }
    }

    return days;
}

async function readMeta() {
    const token = process.env.META_ADS_TOKEN;
    const account = process.env.META_AD_ACCOUNT_ID;

    if (!token || !account) return { off: true };

    try {
        const url = 'https://graph.facebook.com/v21.0/act_' + account + '/insights'
            + '?level=account&time_increment=1&date_preset=last_7d'
            + '&fields=spend,impressions,actions&access_token=' + token;
        const response = await fetch(url, { cache: 'no-store' });
        const payload = await response.json();

        if (!payload.data) {
            return { error: payload.error ? payload.error.message : 'кабинет не ответил' };
        }

        const days = {};

        for (const row of payload.data) {
            let scheduled = 0;
            let leads = 0;

            for (const action of row.actions || []) {
                const type = action.action_type;
                const value = Number(action.value) || 0;

                if (type === 'schedule' || type === 'offsite_conversion.fb_pixel_schedule') scheduled += value;
                if (type === 'lead' || type === 'offsite_conversion.fb_pixel_lead') leads += value;
            }

            days[row.date_start] = {
                spend: Number(row.spend) || 0,
                impressions: Number(row.impressions) || 0,
                scheduled,
                leads
            };
        }

        return { days };
    } catch (e) {
        return { error: e.message };
    }
}

function money(value) {
    return '€' + value.toFixed(2);
}

function cell(value, muted) {
    const style = muted ? ' class="muted"' : '';

    return '<td' + style + '>' + value + '</td>';
}

export async function GET(request) {
    const secret = process.env.ADMIN_API_KEY;

    if (!secret) {
        return new Response('Выключено: не задан ADMIN_API_KEY', { status: 503 });
    }

    const provided = request.headers.get('x-admin-key')
        || request.nextUrl.searchParams.get('key');

    if (provided !== secret) {
        return new Response('Unauthorized', { status: 401 });
    }

    const [bot, meta] = await Promise.all([readBot(), readMeta()]);
    const last = today();
    const range = [];

    for (let i = DAYS - 1; i >= 0; i--) range.push(shiftDay(last, -i));

    const rows = [];
    const total = { spend: 0, leads: 0, bookings: 0, openedBot: 0, lessons: 0, attended: 0, noShow: 0, paid: 0 };

    for (const key of range) {
        const b = bot[key] || emptyDay();
        const m = (meta.days && meta.days[key]) || null;
        const live = b.bookings - b.cancelled;

        total.spend += m ? m.spend : 0;
        total.leads += m ? m.leads : 0;
        total.bookings += b.bookings;
        total.openedBot += b.openedBot;
        total.lessons += b.lessons;
        total.attended += b.attended;
        total.noShow += b.noShow;
        total.paid += b.paid;

        rows.push('<tr>'
            + '<th scope="row">' + key + (key === last ? ' <span class="tag">сегодня</span>' : '') + '</th>'
            + cell(m ? money(m.spend) : '—', !m)
            + cell(m ? m.impressions : '—', !m)
            + cell(m ? m.leads : '—', !m)
            + cell('<b>' + b.bookings + '</b>')
            + cell(live, live === 0)
            + cell(b.openedBot)
            + cell(b.confirmed, b.confirmed === 0)
            + cell(b.lessons, b.lessons === 0)
            + cell(b.attended ? '<b class="good">' + b.attended + '</b>' : '0', !b.attended)
            + cell(b.noShow ? '<b class="bad">' + b.noShow + '</b>' : '0', !b.noShow)
            + cell(b.unmarked ? '<b class="warn">' + b.unmarked + '</b>' : '0', !b.unmarked)
            + cell(b.paid ? '<b class="good">' + b.paid + '</b>' : '0', !b.paid)
            + '</tr>');
    }

    const future = Object.keys(bot).filter(key => key > last).sort()
        .map(key => '<tr><th scope="row">' + key + '</th>'
            + cell(bot[key].lessons) + cell(bot[key].confirmed, !bot[key].confirmed) + '</tr>')
        .join('');

    const costLead = total.leads ? money(total.spend / total.leads) : '—';
    const costBooking = total.bookings ? money(total.spend / total.bookings) : '—';
    const costAttended = total.attended ? money(total.spend / total.attended) : '—';
    const costPaid = total.paid ? money(total.spend / total.paid) : '—';
    const reach = total.lessons ? Math.round(100 * total.attended / total.lessons) + '%' : '—';

    const notice = meta.off
        ? '<p class="notice">Колонки кабинета пустые: не заданы <code>META_ADS_TOKEN</code> и <code>META_AD_ACCOUNT_ID</code>.</p>'
        : (meta.error ? '<p class="notice">Кабинет не ответил: ' + meta.error + '</p>' : '');

    const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<meta name="robots" content="noindex, nofollow">'
        + '<title>SAY YES — сводка</title><style>'
        + ':root{color-scheme:light}'
        + 'body{margin:0;padding:32px;background:#f6f7f9;color:#14161a;'
        + 'font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
        + 'h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 8px}'
        + '.sub{color:#6b7280;margin:0 0 24px;font-size:13px}'
        + '.cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px}'
        + '.card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;min-width:132px}'
        + '.card .k{color:#6b7280;font-size:12px;margin-bottom:4px}'
        + '.card .v{font-size:22px;font-weight:650;letter-spacing:-.02em}'
        + 'table{border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;'
        + 'border-radius:10px;overflow:hidden;font-variant-numeric:tabular-nums}'
        + 'th,td{padding:9px 12px;text-align:right;border-bottom:1px solid #f0f1f3;white-space:nowrap}'
        + 'thead th{background:#fafbfc;font-size:12px;color:#4b5563;font-weight:600;text-align:right}'
        + 'tbody th[scope=row]{text-align:left;font-weight:500}'
        + 'tbody tr:last-child td,tbody tr:last-child th{border-bottom:0}'
        + '.muted{color:#c2c7ce}.good{color:#15803d}.bad{color:#b91c1c}.warn{color:#b45309}'
        + '.tag{background:#eef2ff;color:#4338ca;border-radius:5px;padding:1px 6px;font-size:11px}'
        + '.notice{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 14px;font-size:13px}'
        + 'code{background:#f3f4f6;border-radius:4px;padding:1px 5px;font-size:12px}'
        + 'footer{color:#9aa0a8;font-size:12px;margin-top:32px}'
        + '</style></head><body>'
        + '<h1>SAY YES — деньги и доходимость</h1>'
        + '<p class="sub">Сутки считаются в UTC+3, как в боте. Обновляется при каждой загрузке страницы.</p>'
        + notice
        + '<div class="cards">'
        + '<div class="card"><div class="k">Потрачено, 7 дней</div><div class="v">' + money(total.spend) + '</div></div>'
        + '<div class="card"><div class="k">Заявка</div><div class="v">' + costBooking + '</div></div>'
        + '<div class="card"><div class="k">Пришедший</div><div class="v">' + costAttended + '</div></div>'
        + '<div class="card"><div class="k">Оплата</div><div class="v">' + costPaid + '</div></div>'
        + '<div class="card"><div class="k">Доходимость</div><div class="v">' + reach + '</div></div>'
        + '</div>'
        + '<table><thead><tr>'
        + '<th>Дата</th><th>Траты</th><th>Показы</th><th>Lead</th>'
        + '<th>Заявок</th><th>Живых</th><th>В боте</th><th>Подтв.</th>'
        + '<th>Уроков</th><th>Пришли</th><th>Не пришли</th><th>Без отметки</th><th>Оплат</th>'
        + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>'
        + '<h2>Расписание вперёд</h2>'
        + '<table><thead><tr><th>Дата</th><th>Уроков</th><th>Подтвердили</th></tr></thead>'
        + '<tbody>' + (future || '<tr><td colspan="3" class="muted">пусто</td></tr>') + '</tbody></table>'
        + '<footer>Первые четыре колонки — рекламный кабинет, остальные — база бота. '
        + 'Цена лида в кабинете считается по событиям, здесь — по реальным заявкам.</footer>'
        + '</body></html>';

    return new Response(html, {
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store'
        }
    });
}
