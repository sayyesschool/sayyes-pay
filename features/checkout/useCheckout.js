import { useCallback, useState } from 'react';

export function useCheckout(user) {
    const [loading, setLoading] = useState(false);

    const checkout = useCallback(async (price_id) => {
        if (!user) return alert("Сначала войдите");

        setLoading(true);
        const res = await fetch("/api/stripe/create-checkout-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: user.email,
                price_id
            })
        });
        const data = await res.json();
        setLoading(false);

        if (data.url) {
            window.location.href = data.url;
        } else {
            alert(data.error || "Не удалось создать платеж");
        }
    }, [user]);

    return { checkout, loading };
}