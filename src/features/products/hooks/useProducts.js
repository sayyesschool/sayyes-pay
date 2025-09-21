import { useEffect, useRef, useState } from 'react';

export function useProducts() {
    const [products, setProducts] = useState(null);
    const loadingRef = useRef(false);

    useEffect(() => {
        if (products || loadingRef.current) return;

        loadingRef.current = true;

        fetch("/api/products")
            .then(res => res.json())
            .then(data => {
                setProducts(data.products || []);
            })
            .finally(() => {
                loadingRef.current = false;
            });
    }, [products]);

    return products;
}