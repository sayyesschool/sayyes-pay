import { useState } from 'react';
import Layout from '../components/Layout';
import { supabase } from '../lib/supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function sendLink(e) {
    e.preventDefault();
    setError('');
    const base = process.env.NEXT_PUBLIC_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
    const redirectTo = `${base}/dashboard`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo }
    });

    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <Layout>
      <div className="card">
        <h2>Вход по email</h2>
        {sent ? (
          <p>Мы отправили письмо на <b>{email}</b>. Откройте ссылку из письма, чтобы войти.</p>
        ) : (
          <form onSubmit={sendLink}>
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <div style={{ marginTop: 12 }}>
              <button className="btn primary" type="submit">Получить ссылку</button>
            </div>
          </form>
        )}
        {error && <p className="small" style={{ color: '#fca5a5' }}>{error}</p>}
      </div>
    </Layout>
  );
}
