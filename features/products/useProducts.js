import { useEffect, useState } from 'react';

export function useProducts() {
    const [products, setProducts] = useState([]);

    useEffect(() => {
        console.log('GET PRODUCTS');
        fetch("/api/products")
            .then(res => res.json())
            .then(data => setProducts(data.items || []));
    }, []);

    return products;
}