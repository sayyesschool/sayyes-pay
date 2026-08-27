import {
  SESSION_COMPLETED_EVENT,
  getWebhookEvent,
  getCheckoutSessionDataForPurchase
} from '@/services/stripe';
import { sendPurchase } from '@/lib/meta';

export async function POST(request) {
  try {
    const event = await getWebhookEvent(request);

    if (event.type === SESSION_COMPLETED_EVENT) {
      const purchaseData = await getCheckoutSessionDataForPurchase(event.data.object);

      // Purchase в Meta Conversions API. В момент оплаты браузера нет, пиксель
      // сработать не может — без серверного события Мета не знает, какая реклама
      // принесла деньги. Матчинг по хешам почты и телефона плюс _fbp/_fbc из заявки.
      // Без META_CAPI_TOKEN вызов молча пропускается.
      try {
        await sendPurchase({
        // Точная связка с заявкой: id приезжает из метаданных сессии Stripe.
        // Если его нет (старая ссылка), meta.js найдёт заявку по почте.
        bookingId: purchaseData.metadata && purchaseData.metadata.booking_id,
          email: purchaseData.email,
          value: Number(purchaseData.amount || 0) / 100,
          currency: purchaseData.currency,
          eventId: 'stripe_' + purchaseData.sessionId,
          contentName: purchaseData.label,
          sourceUrl: 'https://sayyes.school/'
        });
      } catch (e) {
        console.error('CAPI purchase (stripe) error:', e);
      }

      await fetch('https://api.sayyes.school/payment', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uuid: purchaseData.externalId,
          amount: purchaseData.amount,
          currency: purchaseData.currency,
          description: purchaseData.label,
          status: 'succeeded',
          operator: 'stripe',
          purpose: 'Оплата обучения',
          paid: true,
          metadata: {
            email: purchaseData.email,
            sessionId: purchaseData.sessionId,
            ...purchaseData.metadata
          }
        })
      });
    }

    return new Response('ok', { status: 200 });
  } catch (error) {
    return new Response(error.message, {
      status: error.cause?.code || 400
    });
  }
}
