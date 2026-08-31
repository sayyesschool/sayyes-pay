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

export default function Checkout({ products, groupId, packId }) {
    // Менеджер прислал ссылку на конкретный пакет — открываем оформление
    // сразу на нём: клиенту нечего выбирать и не в чем ошибаться.
    const preselected = packId
        ? products.find(product => product.external_id === packId)
        : null;

    const [view, setView] = useState(preselected ? View.Contact : View.Pack);
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
    const packs = groupProducts;
    const groupName = groupProducts[0]?.name;

    if (!groupProducts.length) return null;

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
