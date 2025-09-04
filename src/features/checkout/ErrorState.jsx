const ERROR_IMAGE_SRC = 'https://static.sayes.ru/images/cat/cat-sad.png';

export default function ErrorState({ error }) {
    const subject = encodeURIComponent('Ошибка при оплате');
    const body = encodeURIComponent(error?.message ?? '');
    const href = `mailto:help@sayyes.school?subject=${subject}&body=${body}`;

    return (
        <div className="error-state">
            <img src={ERROR_IMAGE_SRC} alt="" />
            <h2 className="heading-3 mb-s">Ошибка</h2>

            {error?.message &&
                <p className="text--body1 w-100 mb-s">{error.message}</p>
            }

            <p className="text--body1 w-100 mb-s">Попробуйте выполнить действие еще раз. Если вновь будет ошибка, <a className="link link--primary" href={href}>напишите нам на почту</a>, мы исправим её как можно быстрее.</p>
        </div>
    );
}