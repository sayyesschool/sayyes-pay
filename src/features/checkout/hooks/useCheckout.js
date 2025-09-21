import { useCallback, useState } from 'react';

export function useCheckout() {
    const [loading, setLoading] = useState(false);

    const checkout = useCallback(async ({ email, price_id }) => {
        setLoading(true);
        const res = await fetch("/api/stripe/create-checkout-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, price_id })
        });
        const data = await res.json();
        setLoading(false);

        if (data.url) {
            window.location.href = data.url;
        } else {
            alert(data.error || "Не удалось создать платеж");
        }
    }, []);

    return { checkout, loading };
}