"use client";

import Loader from '@/components/loader';
import Page from '@/components/page';
import Section from '@/components/section';
import { usePurchases } from '@/features/purchases/client';
import { useUser } from '@/features/user/client';

export default function Dashboard() {
	const user = useUser();
	const purchases = usePurchases(user);

	if (user === undefined) {
		return <Loader size="lg" />;
	}

	return (
		<Page user={user} auth>
			<Section title="Мои покупки" description={purchases.length === 0 && 'Пока пусто'}>
				{purchases.length === 0 && (
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
