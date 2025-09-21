import { Button, Input, Radio } from '@/ui';
import Select from '@/ui/select';

export default function RequestForm() {
    const submit = (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        console.log(Object.fromEntries(formData.entries()));
        e.target.reset();
    };

    return (
        <form id="request-form" className="request-form form" onSubmit={submit}>
            <input type="hidden" name="type" value="lesson" />

            <div className="request-form__contact">
                <Input name="name" type="text" placeholder="Имя*" required />
                <Input name="phone" type="tel" placeholder="Телефон*" required />
                <Input name="email" type="email" placeholder="Email*" required />

                <div className="request-form__communication">
                    <Select
                        label="Выберите удобный способ связи:"
                        name="communication"
                        defaultValue="call"
                        options={[
                            { value: 'call', label: 'Позвоните мне' },
                            { value: 'whatsapp', label: 'Напишите мне на почту' },
                            { value: 'telegram', label: 'Напишите мне в Telegram' },
                            { value: 'email', label: 'Напишите мне на почту' }
                        ]}
                        onChange={event => console.log('Select changed:', event.target.value)}
                    />
                </div>

                <div className="request-form__submit">
                    <Button content="Записаться" type="submit" full />

                    {/* <small className="text text--small">Нажимая «Записаться», я принимаю <a className="link link--underlined" href="https://sayyes.school/agreement">Пользовательское соглашение</a> и даю согласие на обработку своих персональных данных на условиях <a className="link link--underlined" href="https://sayyes.school/politika-konfidentsialnosti">Политики конфиденциальности</a>.</small> */}
                </div>
            </div>
        </form>
    );
};