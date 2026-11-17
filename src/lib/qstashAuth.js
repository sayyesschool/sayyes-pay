import crypto from 'crypto';

// Запуски крона от Upstash QStash (17.11.2026). QStash подписывает каждый запрос
// JWT в заголовке Upstash-Signature ключом подписи из консоли Upstash. Ключи лежат
// в переменных QSTASH_CURRENT_SIGNING_KEY и QSTASH_NEXT_SIGNING_KEY (их два, чтобы
// ключ можно было сменить без простоя). Секрет крона в QStash вписывать не нужно.
// Проверка по документации: https://upstash.com/docs/qstash/howto/signature

const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const norm = s => String(s || '').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function verifyWith(key, token, rawBody) {
  const parts = String(token || '').split('.');

  if (parts.length !== 3 || !key) return false;

  const [h, p, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', key).update(h + '.' + p).digest());

  if (expected.length !== norm(sig).length
    || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(norm(sig)))) return false;

  let claims;

  try {
    claims = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (e) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  if (claims.iss !== 'Upstash') return false;
  if (claims.exp && now > claims.exp + 60) return false;
  if (claims.nbf && now < claims.nbf - 60) return false;
  // Адрес назначения: только наш крон напоминаний.
  if (claims.sub && !/\/api\/cron\/reminders\/?$/.test(String(claims.sub))) return false;

  const bodyHash = b64url(crypto.createHash('sha256').update(rawBody || '').digest());

  return !claims.body || norm(claims.body) === bodyHash;
}

export function qstashConfigured() {
  return Boolean(process.env.QSTASH_CURRENT_SIGNING_KEY || process.env.QSTASH_NEXT_SIGNING_KEY);
}

export function verifyQstash(signature, rawBody) {
  if (!signature) return false;

  return verifyWith(process.env.QSTASH_CURRENT_SIGNING_KEY, signature, rawBody)
    || verifyWith(process.env.QSTASH_NEXT_SIGNING_KEY, signature, rawBody);
}
