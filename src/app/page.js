"use client";

import Loader from '@/components/loader';
import Page from '@/components/page';
import Hero from '@/components/hero';
import Section from '@/components/section';
import Footer from '@/components/footer';
import { useUser } from '@/features/user/client';
import { Products, useProducts } from '@/features/products/client';
import { useCheckout } from '@/features/checkout/client';
import { RequestForm } from '@/features/requests/client';
import useScrollTo from '@/hooks/useScrollTo';

import { Button } from '@/ui';

export default function Home() {
	const user = useUser();
	const products = useProducts();
	const { checkout } = useCheckout(user);
	const scrollToProducts = useScrollTo('#products', {
		block: 'start'
	});

	if (user === undefined) {
		return <Loader size="lg" />;
	}

	return (
		<Page user={user}>
			<Hero
				title="Английский — твой путь к успеху!"
				description="Более 12 лет опыта. Более 5 000 историй успеха!"
			>
				<div className="mt-xxl mb-xxl">
					<Button color="yellow" onClick={scrollToProducts}>
						Записаться на пробное занятие
					</Button>
				</div>
			</Hero>

			<Section
				id="about"
				title="«Английский с ощутимым результатом уже через месяц занятий»"
				description="Команда преподавателей отвечает за ваш прогресс, а менеджеры создают приятную атмосферу, в которую хочется возвращаться."
				centered
			>
				<div className="flex-column gap-l align-center">
					<img className="image" src="https://sayyes.school/wp-content/uploads/2024/09/about-mainscreen.jpg" alt="О нас" />
				</div>
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

			<Section
				title="Оставьте заявку на пробный урок"
				description="Мы свяжемся с вами, запишем на урок, ответим на вопросы и расскажем о курсах"
				centered
			>
				<div className="card card--yellow" style={{ maxWidth: 600, margin: '0 auto' }}>
					<div className="card__body">
						<RequestForm />
					</div>
				</div>
			</Section>

			<Footer />
		</Page>
	);
}
