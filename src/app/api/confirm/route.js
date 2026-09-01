import { getBooking, updateBooking } from '@/lib/redis';
import { sendTrialConfirmed } from '@/lib/meta';
import { notifyManagers } from '@/lib/managers';
import { localSlot } from '@/lib/time';

// Подтверждение записи ссылкой из письма — для тех, у кого нет Telegram.
// Делает ровно то же, что кнопка «Буду на уроке» в боте: ставит отметку,
// шлёт SubmitApplication в рекламу и предупреждает менеджеров.
//
// Код заявки случаен и восьмизначен, поэтому самой ссылки достаточно:
// худшее, что может сделать посторонний — подтвердить чужой урок.
function page(title, text, tone) {
  const color = tone === 'bad' ? '#9b2c2c' : '#2f855a';
  const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex, nofollow">'
    + '<title>SAY YES</title><style>'
    + ':root{color-scheme:light}'
    + 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
    + 'background:#f7f7f7;color:#1a1a1a;padding:24px;'
    + 'font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
    + '.card{background:#fff;border-radius:16px;padding:32px 28px;max-width:420px;text-align:center}'
    + '.brand{font-size:16px;font-weight:800;color:#5B2D8E;letter-spacing:.02em;margin-bottom:20px}'
    + 'h1{font-size:22px;margin:0 0 12px;color:' + color + '}'
    + 'p{margin:0;color:#444}'
    + 'a{color:#5B2D8E}'
    + '</style></head><body><div class="card">'
    + '<div class="brand">SAY YES!</div>'
    + '<h1>' + title + '</h1><p>' + text + '</p>'
    + '</div></body></html>';

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function whenText(booking) {
  const local = localSlot(booking);

  if (local) return local.date + ', ' + local.time;

  return (String(booking.slotDate || '') + ' ' + String(booking.slotLocal || '')).trim();
}

export async function GET(request) {
  const id = request.nextUrl.searchParams.get('b');
  const booking = id ? await getBooking(id) : null;

  if (!booking) {
    return page('Запись не найдена', 'Похоже, ссылка устарела. Напишите нам — мы разберёмся.', 'bad');
  }

  if (booking.status === 'cancelled') {
    return page('Запись отменена', 'Этот урок был отменён. Записаться заново: <a href="https://www.sayyestoenglish.com/learn_easy">выбрать время</a>.', 'bad');
  }

  const when = whenText(booking);

  if (booking.confirmed) {
    return page('Всё уже подтверждено', 'Ждём вас ' + when + '.');
  }

  await updateBooking(booking.id, {
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    confirmedVia: 'email'
  });

  try {
    await sendTrialConfirmed({ ...booking, confirmed: true });
  } catch (e) {
    console.error('CAPI confirm error:', e);
  }

  try {
    await notifyManagers(
      '🙋 Подтвердил(а) по почте: ' + (booking.name || 'ученик')
      + ', ' + when + '.'
    );
  } catch (e) {
    console.error('Notify managers error:', e);
  }

  return page('Спасибо, ждём вас!', 'Урок ' + when + '. Ссылка на Zoom — в письме с подтверждением записи.');
}
