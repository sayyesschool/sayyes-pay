import { Button, Radio } from '@/ui';

export default function Type({ types, selectedType, onChange, onNext }) {
    return (
        <div className="flex-column gap-l">
            <div className="list gap-s">
                {types.map(type =>
                    <div key={type.id} className="list-item">
                        <Radio
                            key={type.id}
                            name="type"
                            value={type.id}
                            label={type.description}
                            checked={type.id === selectedType?.id}
                            onClick={() => onChange(type)}
                        />
                    </div>
                )}
            </div>

            <Button
                className="mh-auto"
                content="Далее"
                disabled={!selectedType}
                outlined
                onClick={onNext}
            />
        </div>
    );
}