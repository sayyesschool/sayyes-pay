import { kvGet, kvSet } from '@/lib/redis';

// Доступы к админке и боту (31.10.2026, макет согласован Димой).
//
// Права:
//   base     - «Управление»: заявки, уроки, отметки, переписка, переносы, ссылки
//              на оплату и проведение оплат; база знаний; менеджер в боте
//   finance  - аналитика с оплатами и рекламой, страница «Оплаты»
//   schedule - открыть и закрыть слоты, часы недели
//   super    - всё, плюс «Объявления» и «Доступы»
//
// Супер-админы из переменной OWNER_TG_USERNAMES (Дима и Оля) задаются на сервере
// и из админки не снимаются: так никто не закроет доступ владельцам по ошибке.
// Остальные люди и их права лежат в базе (admin:users) и правятся в «Доступах».
// Пока в базе пусто, список берётся из MANAGER_TG_USERNAMES с правом base:
// так права у всех остаются ровно такими, какими были до этого раздела.

export const RIGHTS = ['base', 'finance', 'schedule', 'super'];
export const RIGHT_LABEL = { base: 'Базовый', finance: 'Финансы', schedule: 'Расписание', super: 'Супер-админ' };

const USERS_KEY = 'admin:users';
const LOG_KEY = 'admin:access:log';

const clean = name => String(name || '').trim().replace(/^@/, '').toLowerCase();
const list = value => String(value || '').split(',').map(clean).filter(Boolean);

export const SUPER_USERNAMES = list(process.env.OWNER_TG_USERNAMES || 'dp_1988,olia_pi');

const ENV_MANAGERS = list(
  process.env.MANAGER_TG_USERNAMES ||
  process.env.MANAGER_TG_USERNAME ||
  'sayesstephanie,sayyes_kristina,sayyes_roman,sayesviktoria,dp_1988,olia_pi'
);

export function isValidUsername(name) {
  return /^[a-z0-9_]{4,32}$/.test(clean(name));
}

function seed() {
  const users = {};

  for (const name of ENV_MANAGERS) {
    if (!SUPER_USERNAMES.includes(name)) users[name] = { rights: ['base'], addedBy: 'env', at: null };
  }

  return users;
}

// Короткий кэш: права читаются на каждой странице и в каждом сообщении бота.
let cache = null;
let cachedAt = 0;

export async function getUsers() {
  if (cache && Date.now() - cachedAt < 15 * 1000) return cache;

  const stored = await kvGet(USERS_KEY);
  const users = stored && typeof stored === 'object' ? stored : seed();

  for (const name of SUPER_USERNAMES) delete users[name];

  cache = users;
  cachedAt = Date.now();

  return users;
}

function normalize(rights) {
  const set = new Set((rights || []).filter(r => RIGHTS.includes(r)));

  return RIGHTS.filter(r => set.has(r));
}

// Права человека: массив, пустой массив = нет доступа.
export async function rightsOf(username) {
  const name = clean(username);

  if (!name) return [];
  if (SUPER_USERNAMES.includes(name)) return [...RIGHTS];

  const users = await getUsers();
  const rights = normalize(users[name] && users[name].rights);

  return rights.includes('super') ? [...RIGHTS] : rights;
}

export function has(rights, right) {
  return Array.isArray(rights) && (rights.includes('super') || rights.includes(right));
}

// Менеджеры бота: супер-админы и все, у кого есть base.
export async function managerUsernames() {
  const users = await getUsers();
  const names = [...SUPER_USERNAMES];

  for (const [name, u] of Object.entries(users)) {
    const rights = normalize(u && u.rights);

    if ((rights.includes('base') || rights.includes('super')) && !names.includes(name)) names.push(name);
  }

  return names;
}

export async function isBotManager(username) {
  const name = clean(username);

  if (!name) return false;

  return (await managerUsernames()).includes(name);
}

export async function superUsernames() {
  const users = await getUsers();
  const names = [...SUPER_USERNAMES];

  for (const [name, u] of Object.entries(users)) {
    if (normalize(u && u.rights).includes('super') && !names.includes(name)) names.push(name);
  }

  return names;
}

async function save(users, entry) {
  await kvSet(USERS_KEY, users);
  cache = users;
  cachedAt = Date.now();

  const log = (await kvGet(LOG_KEY)) || [];

  log.unshift({ ...entry, at: new Date().toISOString() });
  await kvSet(LOG_KEY, log.slice(0, 200));
}

export async function getAccessLog(limit = 20) {
  const log = (await kvGet(LOG_KEY)) || [];

  return log.slice(0, limit);
}

const describe = rights => rights.length ? rights.map(r => RIGHT_LABEL[r]).join(', ') : 'без прав';

export async function addUser(username, rights, by) {
  const name = clean(username);

  if (!isValidUsername(name)) return { ok: false, error: 'Укажите username в Telegram: латиница, цифры и _, от 4 символов' };
  if (SUPER_USERNAMES.includes(name)) return { ok: false, error: '@' + name + ' уже супер-админ из настроек сервера' };

  const users = { ...(await getUsers()) };

  if (users[name]) return { ok: false, error: '@' + name + ' уже в списке, права меняются в таблице' };

  const r = normalize(rights);

  if (!r.length) return { ok: false, error: 'Отметьте хотя бы одно право' };

  users[name] = { rights: r, addedBy: '@' + by, at: new Date().toISOString() };
  await save(users, { by: '@' + by, who: '@' + name, change: 'добавлен: ' + describe(r) });

  return { ok: true, message: '@' + name + ' добавлен: ' + describe(r), notice: '➕ @' + by + ' добавил @' + name + ': ' + describe(r) };
}

// Таблица целиком: { username: [rights] }. Меняем только тех, у кого права разошлись.
export async function saveRights(table, by) {
  const users = { ...(await getUsers()) };
  const changes = [];

  for (const [name, rights] of Object.entries(table || {})) {
    if (!users[name] || SUPER_USERNAMES.includes(name)) continue;

    const before = normalize(users[name].rights);
    const after = normalize(rights);

    if (before.join() === after.join()) continue;
    if (!after.length) return { ok: false, error: 'У @' + name + ' не осталось ни одного права. Чтобы закрыть доступ, нажмите «Удалить»' };

    users[name] = { ...users[name], rights: after };
    changes.push('@' + name + ': ' + describe(before) + ' → ' + describe(after));
  }

  if (!changes.length) return { ok: true, message: 'Изменений нет' };

  await save(users, { by: '@' + by, who: changes.map(c => c.split(':')[0]).join(', '), change: changes.join('; ') });

  return { ok: true, message: 'Права сохранены', notice: '🔑 @' + by + ' поменял права:\n' + changes.join('\n') };
}

export async function removeUser(username, by) {
  const name = clean(username);
  const users = { ...(await getUsers()) };

  if (SUPER_USERNAMES.includes(name)) return { ok: false, error: 'Супер-админа из настроек сервера отсюда не удалить' };
  if (!users[name]) return { ok: false, error: '@' + name + ' нет в списке' };
  if (name === clean(by)) return { ok: false, error: 'Себя удалить нельзя' };

  delete users[name];
  await save(users, { by: '@' + by, who: '@' + name, change: 'удалён' });

  return { ok: true, message: '@' + name + ' удалён', notice: '➖ @' + by + ' удалил @' + name + ' из доступов' };
}
