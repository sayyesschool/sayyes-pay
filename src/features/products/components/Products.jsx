import data from './data';

export default function Products({ products, onCheckout }) {
    if (!products) return <p>Загрузка...</p>;

    if (products.length === 0) return null;

    const groups = products.reduce((acc, product) => {
        if (!acc[product.group_id]) {
            acc[product.group_id] = product.name;
        }
        return acc;
    }, {});

    return (
        <div className="products">
            <div className="grid grid-2-lg">
                {Object.entries(groups).map(([groupId, groupName]) => (
                    <div key={groupId} className="card card--sm flex-column" >
                        <div className="card__media">
                            <img className="image" src={data[groupId].image} alt="В школе в Москве " />
                        </div>

                        <div className="card__header">
                            <h2 className="card__title">{groupName}</h2>

                            <div className="card__description">{data[groupId].description}</div>
                        </div>

                        <div className="card__body">
                            <button className="pay-btn btn btn--outlined" onClick={() => onCheckout(groupId)}>Выбрать и оплатить</button>
                        </div>
                    </div>
                ))}
            </div>

            <p className="text text--center mt-l">Если у вас возникнут какие-либо вопросы в процессе оплаты, пожалуйста, свяжитесь с вашим менеджером или напишите нам на <a className="link link--primary" href="mailto:info@sayyes.school">info@sayyes.school</a>.</p>
        </div>
    );
}