import { useRef, useCallback, useState } from 'react';
import {
    Button,
    Icon,
    Layout,
    TabBar, Tab,
    TextField,
    Typography
} from 'mdc-react';

import TypeList from './TypeList';
import PackList from './PackList';
import CustomerForm from './CustomerForm';
import CheckoutForm from './CheckoutForm';

import './PaymentForm.scss';

const PaymentForm = ({ promocode, format }) => {
    const promocodeFieldRef = useRef();

    const [view, setView] = useState(format.types ? 'type' : 'pack');
    const [type, setType] = useState();
    const [pack, setPack] = useState();
    const [customer, setCustomer] = useState();
    const [amount, setAmount] = useState(0);
    const [totalAmount, setTotalAmount] = useState(0);
    const [originalAmount, setOriginalAmount] = useState();
    const [hasDiscount, setHasDiscount] = useState(false);

    const handleAmountChange = useCallback((event, value) => {
        setAmount(value);
        setTotalAmount(value);
        setPack(undefined);
    }, []);

    const handlePackChange = useCallback(pack => {
        setPack(pack);
        setTotalAmount(pack.price);
    }, []);

    const handleCustomerSubmit = useCallback(customer => {
        setCustomer(customer);
        setView('checkout');
    }, []);

    const handlePromocode = useCallback(() => {
        const value = promocodeFieldRef.current.control.value;

        if (value?.toUpperCase() !== promocode) return;

        setTotalAmount(amount => {
            setOriginalAmount(amount);
            return amount * 0.8;
        });

        setHasDiscount(true);
    }, [promocode]);

    return (
        <div id="payment-form">
            <TabBar element="header" value={view} stacked onChange={setView}>
                {format.types ?
                    <Tab
                        value="type"
                        icon={<Icon>school</Icon>}
                        label="Тип обучения"
                    /> :
                    <></>
                }
                <Tab
                    value="pack"
                    icon={<Icon>shopping_basket</Icon>}
                    label="Пакет"
                    disabled={!type}
                />
                <Tab
                    value="customer"
                    icon={<Icon>person</Icon>}
                    label="Контактная информация"
                    disabled={!pack && !amount}
                />
                <Tab
                    value="checkout"
                    icon={<Icon>payment</Icon>}
                    label="Оплата"
                    disabled={!customer}
                />
            </TabBar>

            {(format.types && view === 'type') &&
                <section id="type">
                    <TypeList
                        types={format.types}
                        selectedType={type}
                        onChange={setType}
                    />

                    <Button onClick={() => setView('pack')} disabled={!type} outlined>Далее</Button>
                </section>
            }

            {view === 'pack' &&
                <section id="pack">
                    {type &&
                        <Typography element="h3" variant="headline6" noMargin>{type.description}</Typography>
                    }
                    <Typography element="p" variant="subtitle1" noMargin>Выберите пакет:</Typography>

                    <PackList
                        packs={format.packs || type.packs}
                        selectedPack={pack}
                        onChange={handlePackChange}
                    />

                    {format.customPriceAvailable && <>
                        <Typography element="p" variant="subtitle1">или введите сумму самостоятельно:</Typography>

                        <TextField
                            name="amount"
                            value={amount}
                            label="Произвольная сумма"
                            filled
                            onChange={handleAmountChange}
                        />
                    </>}

                    <Button onClick={() => setView('customer')} disabled={!pack && !amount} outlined>Далее</Button>
                </section>
            }

            {view === 'customer' &&
                <section id="customer">
                    <CustomerForm
                        customer={customer}
                        onSubmit={handleCustomerSubmit}
                    />
                </section>
            }

            {view === 'checkout' &&
                <section id="checkout">
                    <CheckoutForm
                        format={format}
                        pack={pack}
                        amount={totalAmount}
                        customer={customer}
                    />

                    <header>
                        {type &&
                            <Typography element="h3" variant="headline6" noMargin>{type.description}</Typography>
                        }

                        {pack &&
                            <Typography element="p" variant={type ? 'subtitle1' : 'headline6'}>{pack.description}</Typography>
                        }
                    </header>

                    <Typography variant="body1">При нажатии на кнопку <strong>Оплатить</strong> вы будете перенаправлены на сайт платежной системы, где сможете выбрать способ оплаты (Банковские карты, Яндекс.Деньги, Qiwi, Сбербанк, Альфа-Банк, Тинькофф, Apple Pay).</Typography>

                    <Typography variant="body2">Нажимая на кнопку <strong>Оплатить</strong> вы принимаете условия <a href="/offer.php" target="_blank">договора-оферты</a>.</Typography>

                    <footer row alignItems="center">
                        <Layout row alignItems="center">
                            <TextField
                                ref={promocodeFieldRef}
                                placeholder="Промокод"
                                filled
                                disabled={hasDiscount}
                            />

                            <Button disabled={hasDiscount} onClick={handlePromocode}>Применить</Button>
                        </Layout>

                        <Layout row alignItems="center">
                            <div className="price-label">
                                {originalAmount ?
                                    <span><del>{originalAmount}</del> <strong>{totalAmount}</strong> руб.</span>
                                    :
                                    <span><strong>{totalAmount}</strong> руб.</span>
                                }
                            </div>

                            <Button type="submit" form="checkout-form" unelevated>Оплатить</Button>
                        </Layout>
                    </footer>
                </section>
            }
        </div >
    );
};

export default PaymentForm;