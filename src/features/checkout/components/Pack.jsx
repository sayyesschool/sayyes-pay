import { Button, Input, Radio } from '@/ui';

export default function Pack({
    prices = [],
    selectedPriceId,
    amount,
    customPriceAvailable,
    onAmountChange,
    onChange,
    onNext
}) {
    return (
        <div className="list gap-s">
            {prices.map(item =>
                <div key={item.price_id} className="list-item">
                    <Radio
                        name="pack"
                        value={item.price_id}
                        checked={item.price_id === selectedPriceId}
                        label={<>
                            {item.description}
                            <span className="price">
                                <strong className="text text--bold">{(item.price / 100).toFixed(2)}</strong> {item.currency?.toUpperCase()}
                            </span>
                        </>}
                        onChange={() => onChange(item.price_id)}
                    />

                </div>
            )}

            {customPriceAvailable && <>
                <p className="text">или введите сумму самостоятельно:</p>

                <Input
                    name="amount"
                    value={amount}
                    placeholder="Произвольная сумма"
                    onInput={event => onAmountChange(event.target.value)}
                />
            </>}

            <Button
                className="mh-auto"
                content="Далее"
                disabled={!selectedPriceId && !amount}
                onClick={onNext}
            />
        </div>
    );
}