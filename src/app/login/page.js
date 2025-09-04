"use client";

import { useState } from 'react';

import supabase from '@/lib/supabase/client';
import Page from '@/components/page';
import Section from '@/components/section';
import { Button, Input } from "@/ui";

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
		<Page>
			<Section title="Вход по email" centered>
				{sent ? (
					<p>Мы отправили письмо на <b>{email}</b>. Откройте ссылку из письма, чтобы войти.</p>
				) : (
					<form className="flex-column align-center gap-s" style={{ maxWidth: '400px' }} onSubmit={sendLink}>
						<Input
							className="input"
							type="email"
							placeholder="you@example.com"
							value={email}
							required
							onChange={(e) => setEmail(e.target.value)}
						/>

						<Button type="submit" size="sm" full>Получить ссылку</Button>
					</form>
				)}

				{error && <p className="small" style={{ color: '#fca5a5' }}>{error}</p>}
			</Section>
		</Page>
	);
}
