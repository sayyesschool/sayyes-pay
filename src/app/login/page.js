"use client";

import { useState } from 'react';

import Page from '@/components/page';
import Section from '@/components/section';
import { signIn } from '@/features/user/client';
import { Button, Input } from "@/ui";

export default function Login() {
	const [email, setEmail] = useState('');
	const [sent, setSent] = useState(false);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function sendLink(e) {
		e.preventDefault();

		setError('');
		setLoading(true);

		await signIn({ email });

		setLoading(false);

		if (error) {
			setError(error.message);
		} else {
			setSent(true);
		}
	}

	return (
		<Page>
			<Section title="Вход по email" centered>
				{sent ? (
					<p className="text text--center">Мы отправили письмо на <b>{email}</b>. Откройте ссылку из письма, чтобы войти.</p>
				) : (
					<form className="flex-column align-center gap-s" style={{ maxWidth: '400px', margin: 'auto' }} onSubmit={sendLink}>
						<Input
							className="input"
							type="email"
							placeholder="you@example.com"
							value={email}
							required
							onChange={(e) => setEmail(e.target.value)}
						/>

						<Button
							content="Получить ссылку"
							type="submit"
							size="sm"
							disabled={loading}
							loading={loading}
							full
						/>
					</form>
				)}

				{error && <p className="small" style={{ color: '#fca5a5' }}>{error}</p>}
			</Section>
		</Page>
	);
}
