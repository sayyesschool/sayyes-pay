import { useCallback, useRef } from 'react';
import http from 'axios';
import { loadStripe } from '@stripe/stripe-js';
import {
    EmbeddedCheckoutProvider,
    EmbeddedCheckout
} from '@stripe/react-stripe-js';

import styles from './styles.module.css';

const stripePromise = loadStripe("pk_test_51S8C57BuEx9CSU7MxLqiYAgTOdZrgRsCGKV8VHmKsBrIp20NywWDm63CqrBLXp6Im1ZtYWFPSo0bLAczRttFZ9Hp009e9fLs1Y");

export default function Payment({
    data,
    onComplete,
    onError
}) {
    const checkoutRef = useRef();

    const fetchClientSecret = useCallback(() => {
        return fetch("/api/stripe/create-checkout-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then((res) => res.json())
            .then((data) => data.clientSecret);
    }, [data]);

    const options = { fetchClientSecret };

    return (
        <div id="checkout" className={styles.root}>
            <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={options}
            >
                <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
        </div>
    );
}