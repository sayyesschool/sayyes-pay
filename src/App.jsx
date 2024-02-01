import { useState } from 'react';
import {
    Dialog,
    LayoutGrid,
    Typography
} from 'mdc-react';

import ProductCard from './components/ProductCard';
import PaymentForm from './components/PaymentForm';

import './App.scss';

const App = ({ data }) => {
    const [format, setFormat] = useState();

    return (
        <main id="content">
            <Typography className="title" element="h2" variant="headline5">Выберите свое обучение:</Typography>

            <section id="products">
                <LayoutGrid>
                    {data.formats.map(format =>
                        <LayoutGrid.Cell key={format.id} span="4">
                            <ProductCard
                                format={format}
                                onSelect={setFormat}
                            />
                        </LayoutGrid.Cell>
                    )}
                </LayoutGrid>
            </section>

            <p className="notice">Если у вас возникнут какие-либо вопросы в процессе оплаты, пожалуйста, свяжитесь с вашим менеджером или напишите нам на <a href="mailto:info@sayes.ru">info@sayes.ru</a>.</p>

            <Dialog
                id="payment-dialog"
                open={Boolean(format)}
                title={format?.title}
                onClose={() => setFormat(undefined)}
            >
                <Dialog.Content>
                    {format &&
                        <PaymentForm
                            promocode={data.promocode}
                            format={format}
                        />
                    }
                </Dialog.Content>
            </Dialog >
        </main >
    );
};

export default App;