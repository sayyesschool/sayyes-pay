"use client";

import Link from 'next/link';

import Page from '@/components/page';
import Section from '@/components/section';

export default function Thanks() {
	return (
		<Page>
			<Section
				title="Спасибо за оплату! 🎉"
				description="Письмо с подтверждением отправлено на ваш email."
				centered
			>
				<img className="image" src="/images/team.jpg" alt="" />
			</Section>
		</Page>
	);
}
