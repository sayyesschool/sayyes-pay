import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSession, can } from '@/lib/adminAuth';
import { addUser, saveRights, removeUser, RIGHTS, superUsernames, saveProfiles } from '@/lib/access';
import { launchOffer, stopOffer } from '@/lib/offerChain';
import { notifyUsers } from '@/lib/managers';
import {
  markAttendance, cancelBooking, rescheduleBooking,
  sendPayLink, markPaid, messageStudent, archiveUnmarked, restoreBooking,
  resendConfirmation, resendAllConfirmations, offerReschedule, replyByEmail
} from '@/lib/adminActions';
import { blockSlots, openSlots, setWeekHours } from '@/lib/schedule';
import { attachPayment, detachPayment, unskipPayment } from '@/lib/stripePayments';
import { addTgSpend, deleteTgSpend } from '@/lib/tgPerformance';

// Все действия менеджера приходят сюда обычной формой, без единой строчки
// клиентского JS: так админка работает на любом телефоне и не ломается,
// когда у ведущей плохой интернет в момент урока.
export async function POST(request) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) return NextResponse.redirect(new URL('/admin/login', request.url), 303);

  const form = await request.formData();
  let action = String(form.get('action') || '');
  // Кнопка «Удалить» в таблице доступов несёт имя прямо в значении: она живёт в общей форме прав.
  let delUser = '';

  if (action.startsWith('access-del:')) {
    delUser = action.slice('access-del:'.length);
    action = 'access-del';
  }
  const id = String(form.get('id') || '');
  const back = String(form.get('back') || '/admin/work');
  const by = session.username;

  let result = { ok: false, error: 'Неизвестное действие' };

  // Какое право нужно для действия. Всё, чего нет в списке, относится к «Базовому».
  const NEED = {
    'tg-spend-add': 'finance', 'tg-spend-del': 'finance',
    'attach-pi': 'finance', 'detach-pi': 'finance', 'unskip-pi': 'finance',
    'week-hours': 'schedule', 'slot-close': 'schedule', 'slot-open': 'schedule',
    'access-add': 'super', 'access-save': 'super', 'access-del': 'super'
  };
  const need = NEED[action] || 'base';

  if (!can(session, need)) {
    const url = new URL(back, request.url);

    url.searchParams.set('msg', 'Ошибка: нет права для этого действия');

    return NextResponse.redirect(url, 303);
  }

  try {
    if (action === 'access-add') {
      result = await addUser(form.get('username'), RIGHTS.filter(r => form.get('r_' + r)), by);
    }
    else if (action === 'access-save') {
      const table = {};
      const profiles = {};

      for (const name of form.getAll('user').map(String)) {
        table[name] = RIGHTS.filter(r => form.get(name + '__' + r));
      }

      for (const name of form.getAll('profile').map(String)) {
        profiles[name] = { name: form.get(name + '__name') || '' };
      }

      const p = await saveProfiles(profiles, by);

      result = p.ok ? await saveRights(table, by) : p;
      if (result.ok && p.changed) result.message = (result.message === 'Изменений нет' ? '' : result.message + '. ') + 'Профили для клиентов сохранены';
    }
    else if (action === 'access-del') result = await removeUser(delUser || String(form.get('username') || ''), by);
    else if (action === 'attended') result = await markAttendance(id, true, by);
    else if (action === 'noshow') result = await markAttendance(id, false, by);
    else if (action === 'cancel') result = await cancelBooking(id, by);
    else if (action === 'restore') result = await restoreBooking(id, by);
    // Разбор после аварии с почтой: письмо не дошло, человек об этом не знает.
    else if (action === 'resend-mail') result = await resendConfirmation(id, by);
    // Галочки в списке: шлём только отмеченным. Пусто — значит всем подходящим.
    else if (action === 'resend-mail-all') {
      result = await resendAllConfirmations(by, form.getAll('pick').map(String).filter(Boolean));
    }
    else if (action === 'mail-reply') result = await replyByEmail(id, String(form.get('text') || ''), by);
    else if (action === 'offer-launch') result = await launchOffer(id, String(form.get('manager') || ''), by);
    else if (action === 'offer-stop') result = await stopOffer(id, by);
    else if (action === 'offer-reschedule') result = await offerReschedule(id, by);
    else if (action === 'reschedule') result = await rescheduleBooking(id, String(form.get('slot') || ''), by);
    else if (action === 'paylink') result = await sendPayLink(id, String(form.get('pack') || ''), by);
    else if (action === 'paid') result = await markPaid(id, form.get('amount'), String(form.get('pack') || ''), by);
    else if (action === 'message') result = await messageStudent(id, String(form.get('text') || ''), by);
    else if (action === 'archive-unmarked') result = await archiveUnmarked(form.get('days'), by);
    // Оплата есть в Stripe, а заявке о ней ничего не известно: счёт выставили
    // руками, вебхук не дошёл, платили не по нашей ссылке. Связываем их здесь.
    // Расход на посевы в Telegram (страница «Перформанс TG»), право «Финансы».
    else if (action === 'tg-spend-add') {
      result = await addTgSpend({
        channel: form.get('channel'), date: String(form.get('date') || ''),
        amountEuro: form.get('amount'), note: form.get('note'), by
      });
    }
    else if (action === 'tg-spend-del') result = await deleteTgSpend(id);
    else if (action === 'attach-pi') result = await attachPayment(String(form.get('pi') || ''), id, by);
    // И наоборот: счёт постоянному ученику мог совпасть по почте с заявкой.
    // К воронке он отношения не имеет, и метка держит его отвязанным навсегда.
    else if (action === 'detach-pi') result = await detachPayment(String(form.get('pi') || ''), by);
    else if (action === 'unskip-pi') result = await unskipPayment(String(form.get('pi') || ''));
    // Часы работы на день недели: задаётся раз, действует на все будущие такие дни.
    else if (action === 'week-hours') {
      result = await setWeekHours(form.get('dow'), String(form.get('from') || ''), String(form.get('to') || ''));
    }
    else if (action === 'slot-close') result = await blockSlots(form.getAll('slot').map(String).filter(Boolean), by);
    else if (action === 'slot-open') result = await openSlots(form.getAll('slot').map(String).filter(Boolean));

    // Изменения доступов видят все супер-админы: права раздаются молча только у плохих систем.
    if (result.ok && result.notice) {
      try {
        await notifyUsers(await superUsernames(), result.notice);
      } catch (e) {
        console.error('Access notice error:', e);
      }
    }
  } catch (e) {
    console.error('Admin action error:', action, e);
    result = { ok: false, error: 'Сорвалось: ' + e.message };
  }

  const url = new URL(back, request.url);

  url.searchParams.set('msg', result.ok ? (result.message || 'Готово') : ('Ошибка: ' + result.error));

  return NextResponse.redirect(url, 303);
}
