import { kvGet, kvSet, kvDel, kvKeys } from '@/lib/redis';

// База знаний школы. Живёт в базе, а не в репозитории: инструкцию должны
// править те, кто по ней работает, без разработчика и без GitHub.

const KEY = slug => 'wiki:' + slug;

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'stranica-' + Date.now().toString(36);
}

export async function listPages() {
  const keys = await kvKeys('wiki:*');
  const pages = [];

  for (const key of keys) {
    const page = await kvGet(key);

    if (page && page.slug) pages.push(page);
  }

  return pages.sort((a, b) => (a.order || 100) - (b.order || 100) || String(a.title).localeCompare(String(b.title)));
}

export async function getPage(slug) {
  return kvGet(KEY(slug));
}

export async function savePage({ slug, title, body, by, order }) {
  const id = slug || slugify(title);
  const existing = await getPage(id);

  const page = {
    slug: id,
    title: title || (existing && existing.title) || id,
    body: body || '',
    order: order || (existing && existing.order) || 100,
    updatedAt: new Date().toISOString(),
    updatedBy: by ? '@' + by : (existing && existing.updatedBy) || null,
    createdAt: (existing && existing.createdAt) || new Date().toISOString()
  };

  await kvSet(KEY(id), page);

  return page;
}

export async function deletePage(slug) {
  await kvDel(KEY(slug));
}

// Маркдаун здесь нарочно простой: заголовки, списки, жирный текст
// и код — больше для инструкции не нужно, а тянуть библиотеку ради этого глупо.
// Сначала экранируем всё, потом добавляем свою разметку.
export function renderMarkdown(text) {
  const esc = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = esc.split('\n');
  const out = [];
  let inList = false;

  const inline = value => value
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/~([^~]+)~/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      if (inList) { out.push('</ul>'); inList = false; }
      continue;
    }

    if (line.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inline(line.slice(2)) + '</li>');
      continue;
    }

    if (inList) { out.push('</ul>'); inList = false; }

    if (line.startsWith('### ')) out.push('<h4>' + inline(line.slice(4)) + '</h4>');
    else if (line.startsWith('## ')) out.push('<h3>' + inline(line.slice(3)) + '</h3>');
    else if (line.startsWith('# ')) out.push('<h2>' + inline(line.slice(2)) + '</h2>');
    else out.push('<p>' + inline(line) + '</p>');
  }

  if (inList) out.push('</ul>');

  return out.join('');
}
