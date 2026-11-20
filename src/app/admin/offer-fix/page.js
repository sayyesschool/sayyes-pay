import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession, can } from '@/lib/adminAuth';
import { Shell } from '@/lib/adminShell';
import { loadBookings } from '@/lib/analytics';
import { kvMGet } from '@/lib/redis';
import { fixPlan, ensureRelayForSent } from '@/lib/offerFix';

export const dynamic = 'force-dynamic';

// Кому цепочка после пробного отправила неверную ссылку (06.11-20.11.2026, исправлено 1215967):
// ссылка вела на главную без пакета за 30 €. Список для извинения и продления срока.
const FROM = '2026-11-06';
const FIXED_AT = '2026-11-20T15:00:00Z';

function when(iso) {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString();

  return d.slice(8, 10) + '.' + d.slice(5, 7) + ' ' + d.slice(11, 16);
}

export default async function OfferFixPage({ searchParams }) {
  const params = await searchParams;
  const message = params?.msg ? String(params.msg) : null;
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');
  if (!can(session, 'super')) redirect('/admin/work');

  const all = (await loadBookings()).filter(b => b.offer && String(b.offer.startedAt || '') >= FROM
    && b.offer.sent && Object.keys(b.offer.sent).some(k => /^[1-4]$/.test(k) && String(b.offer.sent[k]) < FIXED_AT));
  await ensureRelayForSent(all);
  const threads = await kvMGet(all.map(b => 'thread:' + b.id));
  const rows = all.map((b, i) => {
    const t = Array.isArray(threads[i]) ? threads[i] : [];
    const replied = t.some(m => m.from === 'student' && m.at >= b.offer.startedAt);

    return {
      b,
      paid: Boolean(b.introPaid || b.paid),
      replied,
      steps: ['1', '2', '3', '4'].filter(k => b.offer.sent[k]).length,
      channel: b.chatId ? 'бот' : b.email ? 'почта' : '—'
    };
  }).sort((a, c) => (a.paid - c.paid) || String(c.b.offer.startedAt).localeCompare(String(a.b.offer.startedAt)));
  const unpaid = rows.filter(r => !r.paid);

  return (
    <Shell session={session} active="access" title="Неверная ссылка оффера">
      <div className="card">
        <h2>Получили неверную ссылку: {rows.length}, не оплатили: {unpaid.length}</h2>
        <p className="muted">
          С 06.11 по 20.11 ссылка в сообщениях цепочки после пробного вела на главную без пакета за 30 €.
          Ниже все, кому цепочка успела отправить хотя бы одно сообщение со ссылкой.
        </p>
        {message && <div className={'msg' + (message.startsWith('Ошибка') ? ' err' : '')}>{message}</div>}
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Ученик</th><th>Оффер запущен</th><th>Сообщений</th><th>Канал</th><th>Срок был до</th><th>Писал нам</th><th>Причина «что помешало»</th><th>Оплатил</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.b.id}>
                  <td><a href={'/admin/client/' + r.b.id}>{r.b.name || 'Без имени'}</a> <span className="muted">{r.b.id}</span></td>
                  <td>{when(r.b.offer.startedAt)} · {r.b.offer.manager && r.b.offer.manager.name}</td>
                  <td>{r.steps} из 4</td>
                  <td>{r.channel}</td>
                  <td>{when(r.b.offer.deadline)}</td>
                  <td>{r.replied ? 'да' : 'нет'}</td>
                  <td>{r.b.offerReason ? r.b.offerReason.text : '—'}</td>
                  <td className={r.paid ? 'ok' : 'bad'}>{r.paid ? 'да' : 'нет'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Что уйдёт {unpaid.filter(r => !r.b.offerFixSentAt).length} неоплатившим</h2>
        <p className="muted">От имени менеджера, запустившего оффер, в бот (у кого нет бота - письмом). Истёкшим срок продлевается на 72 часа от отправки.</p>
        {unpaid.map(r => {
          const plan = fixPlan(r.b);

          return (
            <div className="row" key={r.b.id} style={{ display: 'block' }}>
              <b>{r.b.name}</b> <span className="muted">· {plan.channel === 'bot' ? 'бот' : 'письмо'} · {plan.expired ? 'срок истёк, продлеваем' : 'срок ещё идёт'}{r.b.offerFixSentAt ? ' · уже отправлено ' + when(r.b.offerFixSentAt) : ''}</span>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{plan.text}</div>
            </div>
          );
        })}
        <form method="post" action="/api/admin/action" style={{ marginTop: 12 }}>
          <input type="hidden" name="action" value="offer-fix-send" />
          <input type="hidden" name="back" value="/admin/offer-fix" />
          <button className="primary" type="submit">Отправить всем неоплатившим</button>
        </form>
      </div>
    </Shell>
  );
}
