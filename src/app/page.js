"use client";

import Page from '@/components/page';
import Hero from '@/components/hero';
import Section from '@/components/section';
import { useUser } from '@/features/user';
import { Products, useProducts } from '@/features/products';
import { useCheckout } from '@/features/checkout';
import { Button } from '@/ui';

export default function Home() {
	const user = useUser();
	const products = useProducts();
	const { checkout } = useCheckout(user);

	return (
		<Page user={user}>
			<Hero
				title="Английский — твой путь к успеху!"
				description="Более 12 лет опыта. Более 5 000 историй успеха!"
			>
				<div className="mt-xxl mb-xxl">
					<Button color="yellow" data-scroll-to="#products">
						Записаться на пробное занятие
					</Button>
				</div>
			</Hero>

			<Section
				id="about"
				title="О нас"
				centered
			>
				<p>Фото/коллаж преподавателей и студентов.</p>
				<p>Текст о школе (адаптировать с sayyes.school).</p>
				<p>Акценты: опыт, методика, индивидуальный подход.</p>
			</Section>

			<Section
				id="products"
				title="Курсы"
				centered
			>
				<Products
					products={products}
					onPurchase={checkout}
				/>
			</Section>

			<Section title="Отзывы" centered>
				<p>Слайдер или сетка с отзывами студентов.</p>
				<p>Фото + текст + звёзды.</p>
			</Section>

			<Section title="Контакты" centered>
				<p>Форма «Оставить заявку».</p>
				<p>Контакты (телефон, email, соцсети).</p>
			</Section>
		</Page>
	);
}
