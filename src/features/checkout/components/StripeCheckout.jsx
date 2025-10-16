import { useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
    EmbeddedCheckoutProvider,
    EmbeddedCheckout
} from '@stripe/react-stripe-js';

const stripePromise = loadStripe("pk_live_51S27OEFuP3FP4gnKjgHZ6O4vHEVZJt99hXAqR6dMGw9WnEVc7ujkTwhpG8WiMbEjAWtHud1JttBdtqQcNK8SePTi00VjA1CDe1");

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
