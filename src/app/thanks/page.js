"use client";

import Link from 'next/link';

import Page from '@/components/page';
import Section from '@/components/section';

export default function Thanks() {
	return (
		<Page>
			<Section title="Спасибо за оплату! 🎉" centered>
				<p className="text text--center">
					Письмо с подтверждением отправлено на ваш email.
					Историю покупок смотрите в <Link className="text--purple" href="/dashboard">личном кабинете</Link>.
				</p>
			</Section>
		</Page>
	);
}
