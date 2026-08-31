import {
  SESSION_COMPLETED_EVENT,
  getWebhookEvent,
  getCheckoutSessionDataForPurchase
} from '@/services/stripe';
import { getBooking, updateBooking } from '@/lib/redis';
import { notifyManagers } from '@/lib/managers';
import { sendPurchase } from '@/lib/meta';

export async function POST(request) {
  try {
    const event = await getWebhookEvent(request);

    if (event.type === SESSION_COMPLETED_EVENT) {
      const purchaseData = await getCheckoutSessionDataForPurchase(event.data.object);

      // Человек мог исправить почту на оплате: значит, в заявке была опечатка.
      // Чинить её нужно и в базе, иначе письма школы так и будут уходить в никуда.
      const bookingId = purchaseData.metadata && purchaseData.metadata.booking_id;
      const pack = (purchaseData.metadata && purchaseData.metadata.pack) || purchaseData.externalId || null;
      const isIntro = Boolean(pack && String(pack).startsWith('INTRO_'));

      if (bookingId) {
        try {
          const booking = await getBooking(bookingId);

          if (booking) {
            const emailChanged = purchaseData.email && booking.email !== purchaseData.email;

            // Отметка оплаты в самой заявке: без неё менеджер не видит, кто заплатил,
            // а клиент может оплатить то же самое второй раз.
            await updateBooking(bookingId, {
              paid: true,
              paidAt: new Date().toISOString(),
              paidPack: purchaseData.label || pack || null,
              paidAmount: purchaseData.amount || null,
              paidCurrency: purchaseData.currency || null,
              paidSessionId: purchaseData.sessionId || null,
              ...(isIntro ? { introPaid: true } : {}),
              ...(emailChanged ? { email: purchaseData.email, emailBeforePayment: booking.email || null } : {})
            });

            // Ссылку могли переслать другому человеку — тогда это не опечатка,
            // а чужая оплата по чужой заявке. Отличить одно от другого может только человек.
            try {
              await notifyManagers(
                '💰 <b>Оплата</b>\n' +
                `${booking.name || 'Ученик'}, код <code>${bookingId}</code>\n` +
                `${purchaseData.label || pack || 'Пакет'} — ${Math.round(Number(purchaseData.amount || 0) / 100)} ${String(purchaseData.currency || '').toUpperCase()}` +
                (emailChanged && booking.email
                  ? `\n⚠️ Оплачено с другой почты: было ${booking.email}, стало ${purchaseData.email}. Проверьте, что это тот же человек.`
                  : '')
              );
            } catch (e) {
              console.error('Payment notification error:', e);
            }
          }
        } catch (e) {
          console.error('Booking payment update error:', e);
        }
      }

      // Purchase в Meta Conversions API. В момент оплаты браузера нет, пиксель
      // сработать не может — без серверного события Мета не знает, какая реклама
      // принесла деньги. Матчинг по хешам почты и телефона плюс _fbp/_fbc из заявки.
      // Без META_CAPI_TOKEN вызов молча пропускается.
      try {
        await sendPurchase({
        // Точная связка с заявкой: id приезжает из метаданных сессии Stripe.
        // Если его нет (старая ссылка), meta.js найдёт заявку по почте.
        bookingId,
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

      // Платёжная база школы может быть недоступна. Раньше её ошибка роняла весь
      // вебхук, Stripe начинал ретраить — и одна оплата записывалась несколько раз.
      try {
        await fetch('https://api.sayyes.school/payment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            // У интро-продуктов нет external_id в Stripe — берём идентификатор из метаданных сессии.
            uuid: pack,
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
      } catch (e) {
        console.error('School payment API error:', e);
      }
    }

    return new Response('ok', { status: 200 });
  } catch (error) {
    return new Response(error.message, {
      status: error.cause?.code || 400
    });
  }
}
