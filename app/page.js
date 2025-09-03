"use client";

import Layout from '@/components/Layout';
import { useUser } from '@/features/user';
import { useProducts } from '@/features/products';
import { useCheckout } from '@/features/checkout';

export default function Home() {
	const user = useUser();
	const products = useProducts();
	const { checkout, loading } = useCheckout(user);

	return (
		<Layout user={user}>
			<div className="card">
				<h2>Выберите пакет и оплатите</h2>
				{!user && <p className="small">Сначала <a href="/login">войдите по email</a>, затем нажмите «Оплатить».</p>}

				{products.length === 0 ? (
					<p>Загружаю товары из Stripe…</p>
				) : (
					<ul>
						{products.map((item) => (
							<li key={item.product_id}>
								<b>{item.name}</b> — {(item.price / 100).toFixed(2)} {item.currency?.toUpperCase()}

								<button className="btn primary" disabled={loading} onClick={() => checkout(item.price_id)}>
									Оплатить
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</Layout>
	);
}
