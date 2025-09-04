import { useState } from 'react';

import { Tab, Tabs } from '@/ui';

import ErrorState from './ErrorState';
import Pack from './Pack';
import Payment from './Payment';
import Type from './Type';
import SuccessState from './SuccessState';

const View = {
    TYPE: 0,
    PACK: 1,
    CONTACT: 2,
    CHECKOUT: 3,
    SUCCESS: 4
};

export default function Checkout({ format }) {
    const [view, setView] = useState(format.types ? View.TYPE : View.PACK);
    const [type, setType] = useState();
    const [pack, setPack] = useState();
    const [amount, setAmount] = useState();
    const [contact, setContact] = useState({});
    const [error, setError] = useState(null);

    if (view === 4)
        return <SuccessState />;

    if (error)
        return <ErrorState error={error} />;

    const types = format.types;
    const packs = type ? type.packs : format.packs;

    return (
        <div className="flex-column gap-l">
            <div className="flex align-center justify-between gap-s">
                <div className="flex-column gap-xs">
                    <h3 className="heading-5">{format.title}</h3>

                    {view > View.TYPE &&
                        <div className="flex align-center gap-xs">
                            {view > View.TYPE && type &&
                                <p className="text--body1">{type.description}</p>
                            }

                            {view > View.PACK && pack && <>
                                <span>·</span>
                                <p className="text--body2">{pack.description}</p>
                            </>}
                        </div>
                    }
                </div>

                {view > View.PACK && (pack || amount) &&
                    <p><span className="heading-5">{amount || pack.price}</span> руб.</p>
                }
            </div>

            <Tabs color="violet" pills>
                {types &&
                    <Tab
                        content="Тип обучения"
                        icon={view >= View.PACK ? 'check' : 'person'}
                        active={view === View.TYPE}
                    />
                }

                <Tab
                    content="Пакет"
                    icon={view >= View.CONTACT ? 'check' : 'person'}
                    active={view === View.PACK}
                />

                <Tab
                    content="Оплата"
                    icon={view >= View.SUCCESS ? 'check' : 'payment'}
                    active={view === View.CHECKOUT}
                />
            </Tabs>

            {view === 0 &&
                <Type
                    types={types}
                    selectedType={type}
                    onChange={setType}
                    onNext={() => setView(View.PACK)}
                />
            }

            {view === 1 &&
                <Pack
                    format={format}
                    packs={packs}
                    selectedPack={pack}
                    amount={amount}
                    customPriceAvailable={format.customPriceAvailable}
                    onChange={setPack}
                    onAmountChange={setAmount}
                    onNext={() => setView(View.CONTACT)}
                />
            }

            {view === 3 &&
                <Payment
                    data={{
                        amount: amount || pack.price,
                        contact,
                        data: {
                            formatId: format?.id,
                            typeId: type?.id,
                            packId: pack?.id
                        },
                        purpose: 'study'
                    }}
                    onComplete={() => setView(View.SUCCESS)}
                    onError={error => setError(error)}
                />
            }
        </div>
    );
}