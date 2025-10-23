import {
  SESSION_COMPLETED_EVENT,
  getWebhookEvent,
  getCheckoutSessionDataForPurchase
} from '@/services/stripe';

export async function POST(request) {
  try {
    const event = await getWebhookEvent(request);

    if (event.type === SESSION_COMPLETED_EVENT) {
      const purchaseData = await getCheckoutSessionDataForPurchase(event.data.object);

      await fetch('https://api.sayyes.school/payment',{
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uuid: purchaseData.externalId,
          amount: purchaseData.amount,
          currency: purchaseData.currency,
          description: label,
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
