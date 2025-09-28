import { useEffect } from 'react';

export default function Payment({
    data,
}) {
    useEffect(() => {
        fetch("/api/stripe/create-checkout-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then((res) => res.json())
            .then((data) => {
                window.location.assign(data.url);
            });
    }, []);

    return (
        <div className="checkout-payment">
            <div className="spinner spinner--lg" />
        </div>
    );
}