"use client";

import Loader from '@/components/loader';
import Page from '@/components/page';
import Hero from '@/components/hero';
import Section from '@/components/section';
import Footer from '@/components/footer';
import { useUser } from '@/features/user/client';
import { Products, useProducts } from '@/features/products/client';
import { RequestForm } from '@/features/requests/client';
import useScrollTo from '@/hooks/useScrollTo';

import { Button } from '@/ui';

export default function Home() {
	const user = useUser();
	const products = useProducts();
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

			<section className="tangible-result section">
				<div className="tangible-result__container section__container">

					<div className="tangible-result__header section__header">
						<h2 className="tangible-result__title section__title">
							Английский <span className="color-primary">с ощутимым результатом</span> уже через месяц занятий
						</h2>

						<div className="tangible-result__description section__description">
							<p>Команда преподавателей отвечает за ваш прогресс, а менеджеры создают приятную атмосферу, в которую хочется возвращаться.</p>
						</div>
					</div>
				</div>
			</section>

			<section className="practice section">
				<div className="practice__container section__container">

					<div className="practice__header section__header">
						<h2 className="practice__title section__title">Максимальная практика английского языка</h2>
					</div>

					<div className="practice__content section__content">
						<div className="text">
							<p>С первого занятия 70% урока говорите вы.</p>
							<p>Ведь чтобы научиться говорить на языке - нужно очень много практиковать.</p>
						</div>

						<div className="picture">
							<img className="image" src="https://sayyes.school/wp-content/themes/sayyes/static/images/pictures/practice.jpg" alt="Практика" />
						</div>
					</div>
				</div>
			</section>

			<section className="dream-team section">
				<div className="dream-team__container section__container">
					<div className="dream-team__header section__header">
						<h2 className="dream-team__title section__title">Преподаватели мечты</h2>
					</div>

					<div className="dream-team__content section__content">
						<div className="dream-team__info">
							<div className="text">
								<p>Влюблены в свое дело и не дадут скучать. Преподаватель SAY&nbsp;YES! — это опытный, харизматичный и современный педагог.</p>

								<p>Оставьте заявку, мы подберем вам преподавателя и расскажем о курсах.</p>
							</div>

							<button className="btn btn--yellow btn--full" data-modal-trigger="request-modal">Оставить заявку</button>
						</div>

						<div className="dream-team__details">
							<div className="dream-team__video">
								<div className="video video--autoplay" data-video-autoplay="true">
									<div className="video__media">
										<video src="https://sayyes.school/wp-content/themes/sayyes/static/videos/teacher.mp4" prealod="metadata" muted="" autoplay="" className="video--playing"></video>
									</div>
								</div>
							</div>

							<div className="dream-team__list">
								<div className="item">
									<div className="item__heading">
										<span className="item__number">1</span>
										<span className="item__text">из 58 кандидатов</span>
									</div>

									<div className="item__description">проходит отбор</div>
								</div>

								<div className="item">
									<div className="item__heading">
										<span className="item__number">2</span>
										<span className="item__text">месяца</span>
									</div>
									<div className="item__description">педагоги обучаются методике Школы</div>
								</div>

								<div className="item">
									<div className="item__heading">
										<span className="item__number">8</span>
										<span className="item__text">лет</span>
									</div>
									<div className="item__description">средний стаж преподавателя</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="platform section">
				<div className="platform__container section__container">
					<div className="platform__header section__header">
						<h2 className="platform__title section__title">Собственная онлайн платформа</h2>
						<div className="platform__description section__description">Для удобного и нескучного закрепления материала дома и проведения онлайн уроков</div>
					</div>

					<div className="platform__content section__content">
						<img className="image" src="https://sayyes.school/wp-content/themes/sayyes/static/images/platform/platform-desktop.jpg" alt="Онлайн платформа" />

						<ul className="list list--check gap-s">
							<li className="list-item">
								<div className="list-item__content">
									<h4 className="list-item__title">Все в одном месте</h4>
									<p className="list-item__description">Быстрый доступ к электронному учебнику, домашним заданиям и личному кабинету.</p>
								</div>
							</li>

							<li className="list-item">
								<div className="list-item__content">
									<h4 className="list-item__title">Эффективное взаимодействие</h4>
									<p className="list-item__description">Во время урока преподаватель сразу видит ваши ответы и подробно объясняет ошибки.</p>
								</div>
							</li>

							<li className="list-item">
								<div className="list-item__content">
									<h4 className="list-item__title">Удобный личный кабинет</h4>
									<p className="list-item__description">Преподаватель добавляет в электронный учебник упражнения, которые полезны именно вам.</p>
								</div>
							</li>
						</ul>
					</div>
				</div>
			</section>

			<section className="practice section">
				<div className="practice__container section__container">

					<div className="practice__header section__header">
						<h2 className="practice__title section__title">Максимальная практика английского языка</h2>
					</div>

					<div className="practice__content section__content">
						<div className="text">
							<p>С первого занятия 70% урока говорите вы.</p>
							<p>Ведь чтобы научиться говорить на языке - нужно очень много практиковать.</p>
						</div>

						<div className="picture">
							<img className="image" src="https://sayyes.school/wp-content/themes/sayyes/static/images/pictures/practice.jpg" alt="Практика" />
						</div>
					</div>
				</div>
			</section>

			<Section
				id="products"
				title="Курсы"
				centered
			>
				<Products
					products={products}
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
