import data from './data';

export default function ProductCard({ groupId, groupName, onCheckout }) {
    return (
        <div key={groupId} className="product-card card card--sm flex-column" >
            <div className="card__media">
                <img className="image" src={data[groupId].image} alt="" />
            </div>

            <div className="card__header">
                <h2 className="card__title">{groupName}</h2>

                <div className="card__description">{data[groupId].description}</div>
            </div>

            <div className="card__body">
                <button className="pay-btn btn btn--outlined" onClick={() => onCheckout(groupId)}>Выбрать и оплатить</button>
            </div>
        </div>
    );
}