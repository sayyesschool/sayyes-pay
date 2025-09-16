import { useEffect, useRef } from 'react';
import http from 'axios';

import styles from './styles.module.css';

export default function Checkout({
    data,
    onComplete,
    onError
}) {
    const checkoutRef = useRef();

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const requestId = params.get('requestId') ?? undefined;
        const utm = {
            source: params.get('utm_source') ?? undefined,
            medium: params.get('utm_medium') ?? undefined,
            campaign: params.get('utm_campaign') ?? undefined,
            content: params.get('utm_content') ?? undefined,
            term: params.get('utm_term') ?? undefined
        };

        http.post('/api/payments/create', {
            ...data,
            requestId,
            utm
        }).then(res => new Promise((resolve, reject) => {
            const payment = res.data;
            const checkout = new window.YooMoneyCheckoutWidget({
                confirmation_token: payment.confirmation.confirmationToken,
                customization: {
                    colors: {
                        control_primary: '#6c167b',
                        background: '#ffffff'
                    }
                },
                error_callback: reject
            });

            checkoutRef.current = checkout;

            checkout.on('success', () => resolve(payment));
            checkout.on('fail', reject);

            checkout.render('checkout');
        })).then(payment => http.post('/api/payments/process', {
            uuid: payment.uuid
        })).then(() => {
            onComplete();
        }).catch(error => {
            console.error(`Checkout error: ${error.message}`);
            onError(error);
        }).finally(() => {
            checkoutRef.current?.destroy();
            checkoutRef.current = null;
        });

        return () => {
            checkoutRef.current?.destroy();
        };
    }, []);

    return (
        <div id="checkout" className={styles.root} />
    );
}