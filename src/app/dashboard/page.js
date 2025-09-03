"use client";

import Layout from '@/components/Layout';
import { usePurchases } from '@/features/purchases';
import { useUser } from '@/features/user';

export default function Dashboard() {
	const user = useUser();
	const purchases = usePurchases(user);

	if (!user) {
		return (
			<Layout>
				<div className="card">
					<h2>Требуется вход</h2>
					<p><a href="/login">Войдите</a>, чтобы видеть свои покупки.</p>
				</div>
			</Layout>
		);
	}

	return (
		<Layout user={user}>
			<div className="card">
				<h2>Мои покупки</h2>

				{purchases.length === 0 ? (
					<p>Пока пусто.</p>
				) : (
					<ul>
						{purchases.map(p => (
							<li key={p.id} className="small">
								<b>{p.product}</b> — {(p.amount / 100).toFixed(2)} {p.currency?.toUpperCase()} • {new Date(p.created_at).toLocaleString()}
								<div>ID транзакции: {p.provider_invoice_id} • статус: {p.status}</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</Layout>
	);
}
