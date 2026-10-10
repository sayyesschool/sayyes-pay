import crypto from 'crypto';

// Проверка данных Telegram Mini App (initData). Воронка, открытая внутри Telegram,
// присылает строку initData, подписанную токеном бота. Без проверки подписи любой
// мог бы прислать чужой Telegram id и записаться от его имени.
// Алгоритм из документации Telegram: secret = HMAC_SHA256("WebAppData", bot_token),
// hash = HMAC_SHA256(secret, data_check_string), строки key=value по алфавиту без hash.
const MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyInitData(initData) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) return { ok: false, reason: 'no bot token' };
  if (!initData || typeof initData !== 'string') return { ok: false, reason: 'empty' };

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');

    if (!hash) return { ok: false, reason: 'no hash' };

    const lines = [];

    for (const [key, value] of params.entries()) {
      if (key === 'hash') continue;
      lines.push(key + '=' + value);
    }

    lines.sort();

    const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const check = crypto.createHmac('sha256', secret).update(lines.join('\n')).digest('hex');

    if (check.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash))) {
      return { ok: false, reason: 'bad hash' };
    }

    const authDate = Number(params.get('auth_date') || 0);

    if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) {
      return { ok: false, reason: 'expired' };
    }

    const user = JSON.parse(params.get('user') || 'null');

    if (!user || !user.id) return { ok: false, reason: 'no user' };

    return {
      ok: true,
      user,
      startParam: String(params.get('start_param') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
    };
  } catch (e) {
    return { ok: false, reason: 'parse error' };
  }
}

export function tgDisplayName(user) {
  return [user && user.first_name, user && user.last_name].filter(Boolean).join(' ').trim();
}
