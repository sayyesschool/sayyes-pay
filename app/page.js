"use client";

import { useEffect, useState } from 'react';

import Layout from '@/components/Layout';
import supabase from '@/lib/supabase/client';

export default function Home() {
	const [user, setUser] = useState(null);
	const [items, setItems] = useState([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		supabase.auth.getUser().then(({ data }) => setUser(data.user || null));
		const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
			setUser(session?.user ?? null);
		});
		return () => sub.subscription.unsubscribe();
	}, []);

	useEffect(() => {
		const load = async () => {
			const res = await fetch("/api/products");
			const data = await res.json();
			setItems(data.items || []);
		};
		load();
	}, []);

	const pay = async (price_id) => {
		if (!user) return alert("Сначала войдите");
		setLoading(true);
		const res = await fetch("/api/stripe/create-checkout-session", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: user.email, price_id })
		});
		const data = await res.json();
		setLoading(false);
		if (data.url) window.location.href = data.url;
		else alert(data.error || "Не удалось создать платеж");
	};

	return (
		<Layout user={user}>
			<div className="card">
				<h2>Выберите пакет и оплатите</h2>
				{!user && <p className="small">Сначала <a href="/login">войдите по email</a>, затем нажмите «Оплатить».</p>}

				{items.length === 0 ? (
					<p>Загружаю товары из Stripe…</p>
				) : (
					<ul>
						{items.map((item) => (
							<li key={item.id}>
								<b>{item.name}</b> — {(item.price / 100).toFixed(2)} {item.currency?.toUpperCase()}
								<button className="btn primary" disabled={loading} onClick={() => pay(item.price_id)}>
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
