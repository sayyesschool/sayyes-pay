"use client";

import Page from '@/components/page';

export default function Thanks() {
	return (
		<Page>
			<div className="card">
				<h2>Спасибо за оплату! 🎉</h2>
				<p>
					Письмо с подтверждением отправлено на ваш email.
					Историю покупок смотрите в <a href="/dashboard">личном кабинете</a>.
				</p>
			</div>
		</Page>
	);
}
