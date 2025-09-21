import { useState } from 'react';
import cn from 'classnames';

import { Item, Modal } from '@/ui';
import { Checkout } from '@/features/checkout/client';

import './Products.scss';

export default function Products({ products, onPurchase }) {
    const [groupId, setGroupId] = useState();
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setModalOpen] = useState(false);

    if (!products) return <p>Загрузка...</p>;

    if (products.length === 0) return null;

    const checkout = async (groupId) => {
        setGroupId(groupId);
        setModalOpen(true);
    };

    const groups = products.reduce((acc, product) => {
        if (!acc[product.group_id]) {
            acc[product.group_id] = product.name;
        }
        return acc;
    }, {});
    const groupProducts = products.filter(product => product.group_id === groupId);

    return (
        <div className="products">
            <div className="grid grid-2-lg">
                {Object.entries(groups).map(([groupId, groupName]) => (
                    <div key={groupId} className="card card--sm flex-column" >
                        <div className="card__media">
                            <img className="image" src="https://sayyes.school/wp-content/themes/sayyes/static/images/corporate-formats/school.jpg" alt="В школе в Москве " />
                        </div>

                        <div className="card__header">
                            <h2 className="card__title">{groupName}</h2>
                        </div>

                        <div className="card__body">
                            <button className="pay-btn btn btn--outlined" onClick={() => checkout(groupId)}>Выбрать и оплатить</button>
                        </div>
                    </div>
                ))}
            </div>

            <Modal
                open={isModalOpen}
                title="Оформление заказа"
                onClose={() => setModalOpen(false)}
            >
                <Checkout products={groupProducts} groupId={groupId} />
            </Modal>
        </div>
    );
}