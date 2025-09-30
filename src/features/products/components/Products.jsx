import ProductCard from './ProductCard';

export default function Products({
    products = [],
    onCheckout
}) {
    const groups = products.reduce((acc, product) => {
        if (!acc[product.group_id]) {
            acc[product.group_id] = product.name;
        }
        return acc;
    }, {});

    const ids = Object.keys(groups).sort((a, b) => a.localeCompare(b));

    return (
        <div className="products">
            <div className="grid grid-2-lg">
                {ids.map(groupId => (
                    <ProductCard
                        key={groupId}
                        groupId={groupId}
                        groupName={groups[groupId]}
                        onCheckout={onCheckout}
                    />
                ))}
            </div>

            <p className="text text--center mt-l">Если у вас возникнут какие-либо вопросы в процессе оплаты, пожалуйста, свяжитесь с вашим менеджером или напишите нам на <a className="link link--primary" href="mailto:info@sayyes.school">info@sayyes.school</a>.</p>
        </div>
    );
}