import { useState } from 'react';
import cn from 'classnames';

import { Item } from '@/ui';

export default function Products({ products, onPurchase }) {
    const [priceId, setPriceId] = useState(null);
    const [loading, setLoading] = useState(false);

    console.log(products);

    const purchase = async (priceId) => {
        setPriceId(priceId);
        setLoading(true);
        await onPurchase(priceId);
        setLoading(false);
    };

    if (!products) return <p>Загрузка...</p>;

    if (products.length === 0) return null;

    const byGroup = products.reduce((acc, product) => {
        (acc[product.name] = acc[product.name] || []).push(product);
        return acc;
    }, {});

    return (
        <div>
            <div className="grid grid-2-lg">
                {Object.keys(byGroup).map((group) => (
                    <div key={group} className="card card--sm flex-column" >
                        <div className="card__media">
                            <img className="image" src="https://sayyes.school/wp-content/themes/sayyes/static/images/corporate-formats/school.jpg" alt="В школе в Москве " />
                        </div>

                        <div className="card__header">
                            <h2 className="card__title">{group}</h2>
                        </div>

                        <div className="card__body">
                            <ul className="list gap-s">
                                {byGroup[group].map((item) => (
                                    <Item key={item.product_id}>
                                        <div className="flex align-center justify-between">
                                            <div className="flex-column gap-xxs">
                                                <span className="text--bold">{item.description}</span>
                                                <span className="text--muted">{(item.price / 100).toFixed(2)} {item.currency?.toUpperCase()}</span>
                                            </div>

                                            <button
                                                className={cn("btn btn--sm btn--outlined", {
                                                    "btn--loading": priceId === item.price_id && loading
                                                })}
                                                disabled={loading}
                                                onClick={() => purchase(item.price_id)}>
                                                Оплатить
                                            </button>
                                        </div>
                                    </Item>
                                ))}
                            </ul>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}