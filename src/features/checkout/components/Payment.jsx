import { useEffect } from 'react';

// Если сессия не создалась, data.url пустой. Раньше переход происходил всё равно —
// и человек попадал на /undefined с 404 вместо страницы оплаты.
function handleSession(data) {
  if (data && data.url) {
    window.location.assign(data.url);
    return;
  }
  console.error('Checkout session failed:', data && data.error ? String(data.error) : 'unknown');

  // notice — это текст, написанный для человека (например, что спецпредложение
  // истекло). Всё остальное показывать нельзя: там внутренние ошибки Stripe.
  const notice = data && typeof data.notice === 'string' ? data.notice : null;

  alert(notice || 'Не удалось открыть оплату. Попробуйте ещё раз или напишите нам — мы поможем.');
}

export default function Payment({
    data,
}) {
    useEffect(() => {
        // Код записи из ссылки менеджера (?b=...). С ним оплата привязывается
        // к конкретной заявке, а не ищется по совпадению почты.
        let bookingId = '';
        try {
            bookingId = new URLSearchParams(window.location.search).get('b') || '';
        } catch (e) {}

        fetch("/api/stripe/create-checkout-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bookingId ? { ...data, booking_id: bookingId } : data)
        })
            .then((res) => res.json())
            .then((data) => {
                handleSession(data);
            });
    }, []);

    return (
        <div className="checkout-payment">
            <div className="spinner spinner--lg" />
        </div>
    );
}
