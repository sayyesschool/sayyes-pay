import { useEffect, useState } from 'react';

export function usePurchases(user) {
    const [purchases, setPurchases] = useState([]);

    const email = user?.email;

    useEffect(() => {
        if (!email) return;

        fetch(`/api/purchases?email=${encodeURIComponent(email)}`)
            .then(res => res.json())
            .then(data => setPurchases(data.purchases || []));
    }, [email]);

    return purchases;
}