'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Вход без паролей: человек открывает бота по ссылке с одноразовым кодом,
// бот узнаёт его телеграм-аккаунт и помечает код как подтверждённый.
//
// Код держим в sessionStorage. Первая версия его теряла: ссылка на Telegram
// уводила ту же вкладку, страница при возврате грузилась заново и начинала
// ждать уже другой код — тот, что подтвердили в боте, никто больше не спрашивал.
const KEY = 'sy_admin_nonce';
const LIFE = 9 * 60 * 1000;

export default function AdminLogin() {
  const [link, setLink] = useState(null);
  const [state, setState] = useState('start');
  const timer = useRef(null);
  const nonce = useRef(null);

  const check = useCallback(async () => {
    if (!nonce.current) return false;

    try {
      const resp = await fetch('/api/admin/auth/check?n=' + nonce.current, { cache: 'no-store' });
      const result = await resp.json();

      if (result.ok) {
        sessionStorage.removeItem(KEY);
        window.location.href = '/admin';

        return true;
      }

      if (result.error === 'no-access') {
        sessionStorage.removeItem(KEY);
        setState('denied');

        return true;
      }

      if (result.error === 'expired') {
        sessionStorage.removeItem(KEY);
        setState('expired');

        return true;
      }
    } catch (e) {
      // молчим: сеть на телефоне отваливается, следующая попытка через 2 секунды
    }

    return false;
  }, []);

  useEffect(() => {
    let stopped = false;

    async function begin() {
      let saved = null;

      try {
        saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      } catch (e) {
        saved = null;
      }

      if (saved && saved.nonce && Date.now() - saved.at < LIFE) {
        nonce.current = saved.nonce;
        setLink(saved.link);
      } else {
        try {
          const resp = await fetch('/api/admin/auth/start', { cache: 'no-store' });
          const data = await resp.json();

          if (stopped) return;

          nonce.current = data.nonce;
          setLink(data.link);
          sessionStorage.setItem(KEY, JSON.stringify({ nonce: data.nonce, link: data.link, at: Date.now() }));
        } catch (e) {
          setState('error');

          return;
        }
      }

      setState('waiting');

      // Сразу проверяем: человек мог подтвердить вход, пока страницы не было.
      if (await check()) return;

      let tries = 0;

      timer.current = setInterval(async () => {
        tries++;

        if (tries > 150) {
          clearInterval(timer.current);
          sessionStorage.removeItem(KEY);
          setState('expired');

          return;
        }

        const done = await check();

        if (done) clearInterval(timer.current);
      }, 2000);
    }

    begin();

    // Вернулись во вкладку из Telegram — спрашиваем сразу, не дожидаясь тика.
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      stopped = true;
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [check]);

  const restart = () => {
    sessionStorage.removeItem(KEY);
    window.location.reload();
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f6f6f8', padding: 20, color: '#16161a',
      fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif'
    }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 380, width: '100%', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>SAY YES — админка</h1>

        {state === 'waiting' && (
          <>
            <p style={{ color: '#71717a', fontSize: 14, marginTop: 0 }}>
              Нажмите кнопку, в открывшемся чате нажмите Start и вернитесь сюда.
            </p>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block', background: '#229ED9', color: '#fff', textDecoration: 'none',
                padding: '12px 22px', borderRadius: 10, fontWeight: 600
              }}
            >
              Войти через Telegram
            </a>
            <p style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 4 }}>Ждём подтверждения…</p>
            <button
              onClick={check}
              style={{ background: 'none', border: 'none', color: '#6d28d9', fontSize: 13, cursor: 'pointer' }}
            >
              Я подтвердил в боте
            </button>
          </>
        )}

        {state === 'denied' && (
          <p style={{ color: '#b91c1c' }}>
            Этот телеграм-аккаунт не в списке менеджеров школы. Попросите добавить его в боте.
          </p>
        )}

        {state === 'expired' && (
          <>
            <p style={{ color: '#71717a' }}>Код устарел.</p>
            <button
              onClick={restart}
              style={{ background: '#16161a', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 10, cursor: 'pointer' }}
            >
              Начать заново
            </button>
          </>
        )}

        {state === 'error' && <p style={{ color: '#b91c1c' }}>Не удалось начать вход. Обновите страницу.</p>}
        {state === 'start' && <p style={{ color: '#71717a' }}>Готовим вход…</p>}
      </div>
    </div>
  );
}
