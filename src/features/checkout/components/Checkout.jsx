import { useState } from 'react';

import { Tab, Tabs } from '@/ui';

import ErrorState from './ErrorState';
import Pack from './Pack';
import Payment from './Payment';
import SuccessState from './SuccessState';
import Contact from './Contact';

import './styles.scss';

const View = {
    Type: 0,
    Pack: 1,
    Contact: 2,
    Payment: 3,
    Success: 4
};

function formatDeadline(value) {
    try {
        return new Date(value).toLocaleString('ru-RU', {
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return null;
    }
}

export default function Checkout({ products, groupId, packId, knownEmail, introExpiresAt }) {
    // Менеджер прислал ссылку на конкретный пакет — открываем оформление
    // сразу на нём: клиенту нечего выбирать и не в чем ошибаться.
    const preselected = packId
        ? products.find(product => product.external_id === packId)
        : null;

    // Почта уже есть в заявке, спрашивать её второй раз незачем: сервер возьмёт
    // её по коду записи. Поэтому сразу шаг оплаты.
    const startView = preselected
        ? (knownEmail ? View.Payment : View.Contact)
        : View.Pack;

    const [view, setView] = useState(startView);
    const [priceId, setPriceId] = useState(preselected?.price_id);
    const [amount, setAmount] = useState();
    const [contact, setContact] = useState({
        name: '',
        email: ''
    });
    const [error, setError] = useState(null);

    if (view === 4) return <SuccessState />;

    if (error) return <ErrorState error={error} />;

    const groupProducts = products.filter(product => product.group_id === groupId);
    // Спецпредложение — ровно то, которое выбрал менеджер. Второй интро-пакет
    // клиенту показывать не нужно: формат обсудили на уроке.
    const packs = preselected?.intro ? [preselected] : groupProducts;
    const groupName = preselected?.intro ? preselected.name : groupProducts[0]?.name;
    const deadline = preselected?.intro && introExpiresAt ? formatDeadline(introExpiresAt) : null;

    if (!packs.length) return null;

    return (
        <div className="checkout flex-column gap-l">
            {groupName && <h3 className="heading-5">{groupName}</h3>}

            {/* Пакет выбрал менеджер — показываем клиенту, за что он платит,
                до того как он введёт почту. */}
            {preselected &&
                <p className="text">
                    {preselected.description} — <strong className="text text--bold">
                        {(preselected.price / 100).toFixed(2)} {preselected.currency?.toUpperCase()}
                    </strong>
                </p>
            }

            {deadline &&
                <p className="text">Специальная цена действует до {deadline}.</p>
            }

            {preselected && knownEmail &&
                <p className="text">Чек и доступ придут на почту, которую вы указали при записи на пробный урок.</p>
            }

            <Tabs color="violet" pills>
                <Tab
                    content="Пакет"
                    active={view === View.Pack}
                />

                <Tab
                    content="Контактные данные"
                    active={view === View.Contact}
                />

                <Tab
                    content="Оплата"
                    active={view === View.Payment}
                />
            </Tabs>

            {view === 1 &&
                <Pack
                    prices={packs}
                    selectedPriceId={priceId}
                    amount={amount}
                    onChange={setPriceId}
                    onAmountChange={setAmount}
                    onNext={() => setView(View.Contact)}
                />
            }

            {view === 2 &&
                <Contact
                    contact={contact}
                    onChange={setContact}
                    onNext={() => setView(View.Payment)}
                />
            }

            {view === 3 &&
                <Payment
                    data={{
                        email: contact.email,
                        price_id: priceId
                    }}
                    onComplete={() => setView(View.Success)}
                    onError={error => setError(error)}
                />
            }
        </div>
    );
}
