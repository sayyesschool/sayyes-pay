import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSession } from '@/lib/adminAuth';
import { Shell } from '@/lib/adminShell';
import { COLUMNS, STRUCTURE_SAMPLE } from '@/lib/metaBulk';

export const dynamic = 'force-dynamic';

// Выгрузка объявлений таблицей. Медиа заранее кладутся в библиотеку кабинета
// (Ads Manager, Media), в таблице на них ссылаются по названию файла.
const SAMPLE = [
  COLUMNS.join(','),
  '120252040840730500,sy_ugc2_3,sy_ugc2_3_4x5|sy_ugc2_3_9x16,"Текст объявления",,"Описание",BOOK_NOW,'
].join('\n');

export default async function AdsPage() {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect('/admin/login');
  if (session.role !== 'owner') redirect('/admin/work');

  return (
    <Shell session={session} active="ads" title="Выгрузка объявлений">
      <div className="card">
        <p>Колонки: <b>{COLUMNS.join(', ')}</b>.</p>
        <p>media: название файла в библиотеке кабинета. Два файла через «|»: первый для ленты (4x5), второй для Stories и Reels (9x16).
          cta по умолчанию BOOK_NOW, link по умолчанию learn_easy. Метки, страница и Instagram подставляются сами.
          Объявления создаются на паузе.</p>
        <form method="post" action="/api/admin/ads-bulk" encType="multipart/form-data">
          <p><input type="file" name="file" accept=".csv,text/csv" /></p>
          <p>или вставьте CSV:</p>
          <textarea name="csv" rows={12} style={{ width: '100%' }} defaultValue={SAMPLE} />
          <div className="btns">
            <button name="mode" value="check">Проверить</button>
            <button name="mode" value="create">Создать на паузе</button>
          </div>
        </form>
      </div>

      <div className="card">
        <p><b>Кампания и группы на паузе.</b> Объявления кладутся только в опубликованную группу, поэтому структура тоже создаётся здесь.
          Бюджет в евро в день на группу.</p>
        <form method="post" action="/api/admin/ads-bulk">
          <textarea name="spec" rows={14} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
            defaultValue={JSON.stringify(STRUCTURE_SAMPLE, null, 2)} />
          <div className="btns">
            <button name="mode" value="structure">Создать кампанию на паузе</button>
          </div>
        </form>
      </div>
    </Shell>
  );
}
