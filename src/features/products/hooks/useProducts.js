import { useEffect, useRef, useState } from 'react';

// Возвращает не массив, а объект: кроме товаров нужно знать, есть ли у нас
// почта по коду записи и до какого момента живёт спецпредложение.
export function useProducts() {
    const [data, setData] = useState(null);
    const loadingRef = useRef(false);

    useEffect(() => {
        if (data || loadingRef.current) return;

        loadingRef.current = true;

        // Код записи из ссылки менеджера — без него сервер отдаст только
        // публичный прайс.
        let query = '';

        try {
            const bookingId = new URLSearchParams(window.location.search).get('b');
            if (bookingId) query = '?b=' + encodeURIComponent(bookingId);
        } catch (e) {}

        fetch('/api/products' + query)
            .then(res => res.json())
            .then(payload => {
                setData({
                    products: payload.products || [],
                    booking: payload.booking || null,
                    introExpiresAt: payload.introExpiresAt || null
                });
            })
            .finally(() => {
                loadingRef.current = false;
            });
    }, [data]);

    return data;
}
