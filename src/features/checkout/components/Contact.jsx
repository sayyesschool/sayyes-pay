import { useState } from 'react';

import { Button, Checkbox, Input } from '@/ui';

export default function Contact({ contact, onChange, onNext }) {
    const [consent, setConsent] = useState(false);

    const isValid = contact.name && contact.email && contact.phone && consent;

    return (
        <div id="contact" className="flex flex-column align-center gap-s">
            <Input
                placeholder="Имя"
                name="name"
                value={contact.name}
                onInput={event => onChange(prev => ({ ...prev, [event.target.name]: event.target.value }))}
            />

            <Input
                placeholder="Email"
                name="email"
                value={contact.email}
                onInput={event => onChange(prev => ({ ...prev, [event.target.name]: event.target.value }))}
            />

            <Input
                placeholder="Телефон"
                name="phone"
                value={contact.phone}
                onInput={event => onChange(prev => ({ ...prev, [event.target.name]: event.target.value }))}
            />

            <Checkbox
                id="consent"
                checked={consent}
                label="Я согласен/на на обработку персональных данных"
                onChange={() => setConsent(v => !v)}
            />

            <Button
                content="Далее"
                disabled={!isValid}
                outlined
                onClick={onNext}
            />
        </div>
    );
}