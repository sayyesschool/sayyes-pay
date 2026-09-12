import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { ADMIN_CSS, SECTIONS } from '@/lib/adminUi';
import { askAssistant } from '@/lib/assistant';

export const dynamic = 'force-dynamic';

const EXAMPLES = [
  'Как отметить оплату, которая прошла мимо кассы?',
  'Сколько заявок было за последние две недели и сколько из них дошло?',
  'Кто не пришёл на уроки на этой неделе?',
  'Что делать, если человек просит перенести урок за час до начала?'
];

export default async function AskPage({ searchParams }) {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');

  const params = await searchParams;
  const question = String(params?.q || '');
  const result = question ? await askAssistant(question) : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_CSS }} />
      <div className="wrap">
        <div className="top">
          <h1>Спросить</h1>
          <div className="who">@{session.username}</div>
        </div>

        <div className="nav">
          {SECTIONS.map(item => (
            <a key={item.key} className={item.key === 'ask' ? 'on' : ''} href={item.href}>{item.label}</a>
          ))}
        </div>

        <form className="card" method="get">
          <div className="field">
            <label>Вопрос по работе школы, воронке, записям или цифрам</label>
            <textarea name="q" defaultValue={question} placeholder="Например: кто из учеников ждёт ссылку на оплату?" style={{ minHeight: 90 }} />
          </div>
          <button className="primary" type="submit">Спросить</button>
        </form>

        {result && result.ok && (
          <div className="card">
            <h2>Ответ</h2>
            <div style={{ whiteSpace: 'pre-wrap' }}>{result.answer}</div>
            <p className="muted">
              Ответ собран из базы знаний, сводных цифр за 30 дней и заявок за последние три недели.
              Проверяйте важные цифры глазами на вкладке аналитики.
            </p>
          </div>
        )}

        {result && !result.ok && <div className="msg err">{result.error}</div>}

        <div className="card">
          <h2>Примеры вопросов</h2>
          {EXAMPLES.map(example => (
            <div className="row" key={example}>
              <a href={'/admin/ask?q=' + encodeURIComponent(example)}>{example}</a>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
