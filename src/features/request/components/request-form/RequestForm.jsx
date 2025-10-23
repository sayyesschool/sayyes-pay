import { useState } from 'react';

import { Button, Input, Select } from '@/ui';

export default function RequestForm({ onSubmit }) {
    const [isLoading, setLoading] = useState(false);

    async function submit(event) {
        event.preventDefault();

        const formData = new FormData(event.target);
        const data = Object.fromEntries(formData.entries());

        setLoading(true);
        fetch('/api/request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                type: data.type,
                contact: {
                    name: data.name,
                    phone: data.phone,
                },
                channel: data.communication,
            })
        }).then(() => {
            event.target.reset();
            onSubmit();
        }).finally(() => {
            setLoading(false);
        });
    };

    return (
        <form id="request-form" className="request-form form" onSubmit={submit}>
            <input type="hidden" name="type" value="request" />

            <div className="request-form__contact">
                <Input name="name" type="text" placeholder="Имя*" required />
                <Input name="phone" type="tel" placeholder="Телефон*" required />

                <div className="request-form__communication">
                    <Select
                        label="Выберите удобный способ связи:"
                        name="communication"
                        defaultValue="call"
                        options={[
                            { value: 'whatsapp', label: 'Напишите мне в WhatsApp' },
                            { value: 'whatsapp-call', label: 'Позвоните мне в WhatsApp' },
                            { value: 'telegram', label: 'Напишите мне в Telegram' },
                            { value: 'telegram-call', label: 'Позвоните мне в Telegram' },
                        ]}
                        onChange={event => console.log('Select changed:', event.target.value)}
                    />
                </div>

                <div className="request-form__submit">
                    <Button
                        content="Записаться"
                        type="submit"
                        loading={isLoading}
                        full
                    />

                    <small className="text text--small">Нажимая «Записаться», я даю согласие на обработку своих персональных данных в соответствии с <a className="link link--underlined" href="/legal/datenschutzerklarung">Политикой конфиденциальности</a>.</small>
                </div>
            </div>
        </form>
    );
};