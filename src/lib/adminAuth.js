import crypto from 'crypto';
import { MANAGER_USERNAMES } from '@/lib/telegram';

// Секрет для подписи сессии берём из токена бота: он и так есть в окружении,
// и отдельную переменную заводить незачем. Сменится токен — разлогинятся все,
// это приемлемо.
const secret = () => process.env.TELEGRAM_BOT_TOKEN || 'sy-dev-secret';

// Управляющие видят деньги и аналитику целиком. Остальные менеджеры — только
// свою работу. Список переопределяется переменной окружения.
export const OWNER_USERNAMES = (process.env.OWNER_TG_USERNAMES || 'dp_1988,olia_pi')
  .split(',')
  .map(name => name.trim().replace(/^@/, '').toLowerCase())
  .filter(Boolean);

export function roleOf(username) {
  const name = String(username || '').trim().replace(/^@/, '').toLowerCase();

  if (!name) return null;
  if (OWNER_USERNAMES.includes(name)) return 'owner';
  if (MANAGER_USERNAMES.includes(name)) return 'manager';

  return null;
}

export const SESSION_COOKIE = 'sy_admin';

export function signSession(username, days = 30) {
  const name = String(username).trim().replace(/^@/, '').toLowerCase();
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
  const body = name + '.' + exp;
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('hex').slice(0, 32);

  return body + '.' + sig;
}

export function readSession(token) {
  if (!token) return null;

  const parts = String(token).split('.');

  if (parts.length !== 3) return null;

  const [username, exp, sig] = parts;
  const want = crypto.createHmac('sha256', secret()).update(username + '.' + exp).digest('hex').slice(0, 32);

  if (sig !== want) return null;
  if (!Number(exp) || Number(exp) < Date.now()) return null;

  const role = roleOf(username);

  if (!role) return null;

  return { username, role };
}
