const SUCCESS_IMAGE_SRC = 'https://static.sayes.ru/images/cat/cat-thumbup.png';

export default function SuccessState() {
    return (
        <div className="success-state">
            <img src={SUCCESS_IMAGE_SRC} alt="" />
            <h2 className="heading-3 mb-s">Оплата прошла успешно</h2>
            <h3 className="heading-4 mb-s">Спасибо за покупку!</h3>
            <p className="text--body1">Вам на почту отправлено письмо с дальнейшими инструкциями.</p>
        </div>
    );
}