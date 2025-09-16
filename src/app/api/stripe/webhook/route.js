import { getWebhookEvent } from '@/lib/stripe';

import {
  SESSION_COMPLETED_EVENT,
  getCheckoutSessionDataForPurchase
} from '@/features/checkout/server';
import { createPurchase } from '@/features/purchases/server';

export async function POST(request) {
  try {
    const event = await getWebhookEvent(request);

    if (event.type === SESSION_COMPLETED_EVENT) {
      const purchaseData = await getCheckoutSessionDataForPurchase(event.data.object);

      await createPurchase(purchaseData);
    }

    return new Response('ok', { status: 200 });
  } catch (error) {
    return new Response(error.message, {
      status: error.cause?.code || 400
    });
  }
}
