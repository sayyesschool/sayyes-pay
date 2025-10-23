"use client";

import { useState } from 'react';

import Hero from '@/components/hero';
import Page from '@/components/page';
import Section from '@/components/section';

import { Checkout } from '@/features/checkout';
import { Products, useProducts } from '@/features/products';
import { RequestForm } from '@/features/request';

import useScrollTo from '@/hooks/useScrollTo';

import { Button, Loader, Modal } from '@/ui';

import './styles.scss';

const defaultGroupId = globalThis.location
	? new URLSearchParams(globalThis.location.search).get('id')?.toUpperCase()
	: undefined;

export default function Home() {
	const products = useProducts();
	const scrollToRequest = useScrollTo('#request', {
		block: 'center'
	});

	const [groupId, setGroupId] = useState(defaultGroupId);
	const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);

	if (!products) {
		return <Loader size="lg" />;
	}

	const handleCheckout = (groupId) => {
		setGroupId(groupId);
	};

	return (
		<Page>
			<Hero
				title="Английский — твой путь к успеху!"
				description="Более 12 лет опыта. Более 5 000 историй успеха!"
				image={<img className="image" src="/images/hero.png" alt="Команда мечты" />}
			>
				<div className="mt-xxl mb-xxl">
					<Button color="yellow" onClick={scrollToRequest}>
						Записаться на пробный урок
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
							<p>С самого первого урока  70% времени говорите вы, ведь разговорная практика - это залог вашего успеха. Мы работаем с 2013 года и всегда верны этому принципу!</p>
							<p>Отработав это правило в  офлайн школе, мы перенесли его в онлайн-среду и успешно применяем с нашими дистанционными студентами.</p>
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
								<p>В «SAY YES!» работают преподаватели, которые не просто учат языку — они заряжают энергией и любовью к учебе.</p>
								<p>Каждый из них прошёл строгий отбор и интенсивные тренинги, чтобы развить профессиональные компетенции на высшем уровне.</p>
								<p>Они умеют вдохновлять, поддерживать и превращать уроки в живое и увлекательное общение. Больше никакого скучного обучения!</p>
							</div>
						</div>

						<div className="dream-team__details">
							<div className="dream-team__image">
								<img className="image" src="/images/teacher.jpg" alt="Преподаватель" />
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

			<section id="manager" className="section section--white section--horizontal">
				<div className="section__container">
					<div className="section__header">
						<h2 className="section__title">Персональный менеджер</h2>

						<div className="section__description">
							<p>Ваш успех начинается с заботы. В «SAY YES!» у каждого студента есть персональный менеджер — человек, который всегда рядом: поддержит, вдохновит и поможет преодолеть любые сложности.</p>
							<p>Мы верим, что обучение должно быть лёгким и приятным, поэтому создаём пространство, где ваш прогресс становится естественным, а каждый шаг вперёд приносит радость.</p>
							<p>С нами вы почувствуете: учиться можно с удовольствием!</p>
						</div>
					</div>

					<div className="section__media">
						<div className="picture">
							<img className="image" src="/images/manager.jpg" alt="Менеджер" />
						</div>
					</div>
				</div>
			</section>

			<Section
				id="products"
				title="Мы предлагаем курсы в различных форматах"
				centered
			>
				<Products
					products={products}
					onCheckout={handleCheckout}
				/>
			</Section>

			<Section
				id="request"
				title="Оставьте заявку на пробный урок"
				description="Мы свяжемся с вами, запишем на урок, ответим на вопросы и расскажем о курсах"
				centered
			>
				<div className="card card--yellow">
					<div className="card__body">
						<RequestForm onSubmit={() => setIsRequestModalOpen(true)} />
					</div>
				</div>
			</Section>

			<Modal
				title="Оформление заказа"
				open={!!groupId}
				onClose={() => setGroupId(undefined)}
			>
				{products &&
					<Checkout
						products={products}
						groupId={groupId}
					/>
				}
			</Modal>

			<Modal
				title="Заявка принята"
				open={isRequestModalOpen}
				onClose={() => setIsRequestModalOpen(false)}
			>
				<p>Спасибо за вашу заявку!</p>
				<p>Мы свяжемся с вами в ближайшее время.</p>
			</Modal>
		</Page>
	);
}
