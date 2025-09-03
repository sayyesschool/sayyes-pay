"use client";

import Layout from '@/components/Layout';

export default function Thanks() {
	return (
		<Layout>
			<div className="card">
				<h2>Спасибо за оплату! 🎉</h2>
				<p>
					Письмо с подтверждением отправлено на ваш email.
					Историю покупок смотрите в <a href="/dashboard">личном кабинете</a>.
				</p>
			</div>
		</Layout>
	);
}
