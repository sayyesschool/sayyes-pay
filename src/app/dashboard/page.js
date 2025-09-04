"use client";

import Page from '@/components/page';
import Section from '@/components/section';
import { usePurchases } from '@/features/purchases';
import { useUser } from '@/features/user';

export default function Dashboard() {
	const user = useUser();
	const purchases = usePurchases(user);

	return (
		<Page user={user} auth>
			<Section title="Мои покупки" className="section">
				{purchases.length === 0 ? (
					<p>Пока пусто</p>
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
			</Section>
		</Page>
	);
}
