'use client';

import { useEffect, useRef, useState } from 'react';

// Вход без паролей: человек открывает бота по ссылке с одноразовым кодом,
// бот узнаёт его телеграм-аккаунт и помечает код как подтверждённый.
// Пароли заводить незачем — список менеджеров уже есть в боте.
export default function AdminLogin() {
  const [link, setLink] = useState(null);
  const [state, setState] = useState('start');
  const timer = useRef(null);

  useEffect(() => {
    let stop = false;

    async function begin() {
      try {
        const resp = await fetch('/api/admin/auth/start');
        const data = await resp.json();

        if (stop) return;

        setLink(data.link);
        setState('waiting');

        let tries = 0;

        timer.current = setInterval(async () => {
          tries++;

          if (tries > 150) {
            clearInterval(timer.current);
            setState('expired');

            return;
          }

          const check = await fetch('/api/admin/auth/check?n=' + data.nonce);
          const result = await check.json();

          if (result.ok) {
            clearInterval(timer.current);
            window.location.href = '/admin';
          } else if (result.error === 'no-access') {
            clearInterval(timer.current);
            setState('denied');
          }
        }, 2000);
      } catch (e) {
        setState('error');
      }
    }

    begin();

    return () => {
      stop = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

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
              Вход через бота: нажмите кнопку, в открывшемся чате нажмите Start.
              Страница откроется сама.
            </p>
            <a
              href={link}
              style={{
                display: 'inline-block', background: '#229ED9', color: '#fff', textDecoration: 'none',
                padding: '12px 22px', borderRadius: 10, fontWeight: 600
              }}
            >
              Войти через Telegram
            </a>
            <p style={{ color: '#a1a1aa', fontSize: 12 }}>Ждём подтверждения…</p>
          </>
        )}

        {state === 'denied' && (
          <p style={{ color: '#b91c1c' }}>
            Этот телеграм-аккаунт не в списке менеджеров школы. Попросите добавить его в боте.
          </p>
        )}

        {state === 'expired' && (
          <p style={{ color: '#71717a' }}>
            Код устарел. <a href="/admin/login">Начать заново</a>.
          </p>
        )}

        {state === 'error' && <p style={{ color: '#b91c1c' }}>Не удалось начать вход. Обновите страницу.</p>}
        {state === 'start' && <p style={{ color: '#71717a' }}>Готовим вход…</p>}
      </div>
    </div>
  );
}
