import { useState } from 'react';

import { Tab, Tabs } from '@/ui';

import { useCheckout } from '../hooks/useCheckout';

import ErrorState from './ErrorState';
import Pack from './Pack';
import Payment from './Payment';
import Type from './Type';
import SuccessState from './SuccessState';
import Contact from './Contact';

const View = {
    Type: 0,
    Pack: 1,
    Contact: 2,
    Payment: 3,
    Success: 4
};

export default function Checkout({ products, groupId }) {
    const { checkout } = useCheckout();

    const [view, setView] = useState(View.Pack);
    const [type, setType] = useState();
    const [priceId, setPriceId] = useState();
    const [amount, setAmount] = useState();
    const [contact, setContact] = useState({});
    const [error, setError] = useState(null);

    if (view === 4)
        return <SuccessState />;

    if (error)
        return <ErrorState error={error} />;

    const packs = products;

    return (
        <div className="flex-column gap-l">
            <div className="flex align-center justify-between gap-s">
                <div className="flex-column gap-xs">
                    <h3 className="heading-5">{groupId}</h3>

                    {view > View.Type &&
                        <div className="flex align-center gap-xs">
                            {view > View.Type && type &&
                                <p className="text--body1">{type.description}</p>
                            }

                            {/* {view > View.Pack && pack && <>
                                <span>·</span>
                                <p className="text--body2">{pack.description}</p>
                            </>} */}
                        </div>
                    }
                </div>

                {/* {view > View.Pack && (pack || amount) &&
                    <p><span className="heading-5">{amount || pack.price}</span> руб.</p>
                } */}
            </div>

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