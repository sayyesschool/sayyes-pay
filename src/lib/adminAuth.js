import crypto from 'crypto';
import { rightsOf, has, SUPER_USERNAMES } from '@/lib/access';

// Права хранятся в «Доступах» (src/lib/access.js). Сессия подписывает только
// username, права читаются при каждом запросе: снятое право действует сразу,
// без перелогина.
export const OWNER_USERNAMES = SUPER_USERNAMES;

export { has };

// Секрет для подписи сессии берём из токена бота: он и так есть в окружении,
// и отдельную переменную заводить незачем. Сменится токен - разлогинятся все.
const secret = () => process.env.TELEGRAM_BOT_TOKEN || 'sy-dev-secret';

export const SESSION_COOKIE = 'sy_admin';

export function signSession(username, days = 30) {
  const name = String(username).trim().replace(/^@/, '').toLowerCase();
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
  const body = name + '.' + exp;
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('hex').slice(0, 32);

  return body + '.' + sig;
}

export async function readSession(token) {
  if (!token) return null;

  const parts = String(token).split('.');

  if (parts.length !== 3) return null;

  const [username, exp, sig] = parts;
  const want = crypto.createHmac('sha256', secret()).update(username + '.' + exp).digest('hex').slice(0, 32);

  if (sig !== want) return null;
  if (!Number(exp) || Number(exp) < Date.now()) return null;

  const rights = await rightsOf(username);

  if (!rights.length) return null;

  // role оставлен для старых проверок и подписи в шапке: owner = супер-админ.
  return { username, rights, role: has(rights, 'super') ? 'owner' : 'manager' };
}

export function can(session, right) {
  return Boolean(session) && has(session.rights, right);
}
