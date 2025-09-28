import { useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
    EmbeddedCheckoutProvider,
    EmbeddedCheckout
} from '@stripe/react-stripe-js';

const stripePromise = loadStripe("pk_test_51S8C57BuEx9CSU7MxLqiYAgTOdZrgRsCGKV8VHmKsBrIp20NywWDm63CqrBLXp6Im1ZtYWFPSo0bLAczRttFZ9Hp009e9fLs1Y");

export default function StripeCheckout({
    data,
    onComplete,
    onError
}) {
    const [clientSecret, setClientSecret] = useState('');

    const fetchClientSecret = useCallback(async () => {
        return fetch("/api/stripe/create-checkout-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then((res) => res.json())
            .then((data) => {
                setClientSecret(data.clientSecret);
            });
    }, [clientSecret]);

    return (
        <EmbeddedCheckoutProvider
            stripe={stripePromise}
            options={{ fetchClientSecret }}
        >
            <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
    );
}