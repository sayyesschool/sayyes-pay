import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import {
  markAttendance, cancelBooking, rescheduleBooking,
  sendPayLink, markPaid, messageStudent, archiveUnmarked
} from '@/lib/adminActions';
import { blockSlots, openSlots } from '@/lib/schedule';

// Все действия менеджера приходят сюда обычной формой, без единой строчки
// клиентского JS: так админка работает на любом телефоне и не ломается,
// когда у ведущей плохой интернет в момент урока.
export async function POST(request) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) return NextResponse.redirect(new URL('/admin/login', request.url), 303);

  const form = await request.formData();
  const action = String(form.get('action') || '');
  const id = String(form.get('id') || '');
  const back = String(form.get('back') || '/admin/work');
  const by = session.username;

  let result = { ok: false, error: 'Неизвестное действие' };

  try {
    if (action === 'attended') result = await markAttendance(id, true, by);
    else if (action === 'noshow') result = await markAttendance(id, false, by);
    else if (action === 'cancel') result = await cancelBooking(id, by);
    else if (action === 'reschedule') result = await rescheduleBooking(id, String(form.get('slot') || ''), by);
    else if (action === 'paylink') result = await sendPayLink(id, String(form.get('pack') || ''), by);
    else if (action === 'paid') result = await markPaid(id, form.get('amount'), String(form.get('pack') || ''), by);
    else if (action === 'message') result = await messageStudent(id, String(form.get('text') || ''), by);
    else if (action === 'archive-unmarked') result = await archiveUnmarked(form.get('days'), by);
    // Расписанием распоряжаются только управляющие: это не ежедневная работа,
    // а решение про загрузку школы.
    else if (action === 'slot-close' || action === 'slot-open') {
      if (session.role !== 'owner') {
        result = { ok: false, error: 'Расписание меняют только управляющие' };
      } else {
        const slots = form.getAll('slot').map(String).filter(Boolean);

        result = action === 'slot-close' ? await blockSlots(slots, by) : await openSlots(slots);
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
