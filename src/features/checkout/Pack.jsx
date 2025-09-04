import { Button, Input, Radio } from '@/ui';

export default function Pack({
    packs,
    selectedPack,
    amount,
    customPriceAvailable,
    onAmountChange,
    onChange,
    onNext
}) {
    return (
        <div className="list gap-s">
            {packs.map(pack =>
                <div key={pack.id} className="list-item">
                    <Radio
                        name="pack"
                        value={pack.id}
                        checked={pack.id === selectedPack?.id}
                        label={<>
                            {pack.description}
                            <span><strong className="text">{pack.price}</strong> руб.</span>
                        </>}
                        onClick={() => onChange(pack)}
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
                disabled={!selectedPack && !amount}
                outlined
                onClick={onNext}
            />
        </div>
    );
}