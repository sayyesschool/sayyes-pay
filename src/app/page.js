"use client";

import Loader from '@/components/loader';
import Page from '@/components/page';
import Hero from '@/components/hero';
import Section from '@/components/section';
import Footer from '@/components/footer';
import { useUser } from '@/features/user';
import { Products, useProducts } from '@/features/products';
import { useCheckout } from '@/features/checkout';
import { RequestForm } from '@/features/requests';
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
				title="О нас"
				description="Школа английского языка SAY YES! С нами вы скажете «Да!» свободе общения с миром."
				centered
			>
				<div className="flex-column gap-l align-center">
					<img className="image" src="https://sayyes.school/wp-content/uploads/2024/09/about-mainscreen.jpg" alt="О нас" />
					<p className="text">Текст о школе (адаптировать с sayyes.school).</p>

					<div className="grid grid-2-sm grid-4-lg">
						<div className="text-card card card--yellow card--sm">
							<h4 className="card__title">Общий курс</h4>
							<p className="card__description">Обучение разговорному английскому языку</p>
						</div>

						<div className="text-card card card--yellow card--sm">
							<h4 className="card__title">Бизнес курс</h4>
							<p className="card__description">Обучение деловому английскому для работы</p>
						</div>

						<div className="text-card card card--yellow card--sm">
							<h4 className="card__title">Курсы для профессионалов</h4>
							<p className="card__description">Программы для конкретных профессий и должностей</p>
						</div>

						<div className="text-card card card--yellow card--sm">
							<h4 className="card__title">Погружение в среду</h4>
							<p className="card__description">Разговорные клубы с носителями английского языка</p>
						</div>
					</div>
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

			<Section title="Отзывы" centered padded>
				<div className="card card--purple">
					<div className="card__body">
						<div className="grid grid-2-md">
							<div className="testimonial-card card">
								<div className="testimonial-excerpt content">
									<p>Хожу сюда уже 2 года, сейчас у меня лучший преподаватель Ульяна. Она использует разные методики для работы, актуализирует знания, подбирает на некоторых уроках материалы которые вам интересны, например сейчас мы разбираем интервью на англ Честера Бенингктона, потому что это мой любимый исполнитель. Ульяна постоянно работает над актцализацией знаний, помогает их… </p>

									<button className="testimonial-modal-button link">Читать весь отзыв</button>
								</div>

								<div className="testimonial-content content">
									<p>Хожу сюда уже 2 года, сейчас у меня лучший преподаватель Ульяна. Она использует разные методики для работы, актуализирует знания, подбирает на некоторых уроках материалы которые вам интересны, например сейчас мы разбираем интервью на англ Честера Бенингктона, потому что это мой любимый исполнитель. Ульяна постоянно работает над актцализацией знаний, помогает их использовать, вникает и грамотно разъясняет все детали. Соотношение цена качество супер, я довольна</p>
								</div>

								<div className="testimonial-meta">
									<div className="testimonial-meta__info">
										<span className="text text--body1 text--bold">Александра Скворцова</span>
										<span className="text text--body2 text--muted">22 февраля, 2024</span>
									</div>

									<div className="stars"></div>
								</div>
							</div>

							<div className="testimonial-card card">
								<div className="testimonial-excerpt content">
									<p>Великолепная школа английского! Занятия в школе имеются, как групповые, так и индивидуальные. При выборе групповых занятий, класс определяют индивидуально для вас, в зависимости от вашего уровня знаний языка. Занятия проходят в дружеской атмосфере с уникальным подходом к обучению (отличное настроение и заряд бодрости на ближайшие пару дней вам гарантированы). Живое… </p>

									<button className="testimonial-modal-button link">Читать весь отзыв</button>
								</div>

								<div className="testimonial-content content">
									<p>Великолепная школа английского! Занятия в школе имеются, как групповые, так и индивидуальные. При выборе групповых занятий, класс определяют индивидуально для вас, в зависимости от вашего уровня знаний языка. Занятия проходят в дружеской атмосфере с уникальным подходом к обучению (отличное настроение и заряд бодрости на ближайшие пару дней вам гарантированы). Живое общение с одногрупниками под наставничеством опытного преподавателя позволит значительно ускорить процесс обучения. Если же вам комфортнее заниматься индивидуально, то для вас лично подберут наиболее подходящего педагога и учтут все ваши пожелания относительно дальнейшего обучения. Однозначно могу сказать, что в этой школе прекрасная клиентоориентированость! А внимательные и заботливые менеджеры школы отслеживают ваш прогресс и, по возможности, корректируют обучение, дают необходимые советы и рекомендают полезные инструменты для наиболее качественного изучения языка.</p>

								</div>

								<div className="testimonial-meta">
									<div className="testimonial-meta__info">
										<span className="text text--body1 text--bold">Герман Т.</span>
										<span className="text text--body2 text--muted">22 февраля, 2024</span>
									</div>

									<div className="stars"></div>
								</div>
							</div>
						</div>
					</div>
				</div>
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
