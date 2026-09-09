import {
  SESSION_COMPLETED_EVENT,
  getWebhookEvent,
  getCheckoutSessionDataForPurchase
} from '@/services/stripe';
import { getBooking, updateBooking, kvSet, kvGet, kvKeys } from '@/lib/redis';
import { notifyManagers } from '@/lib/managers';
import { sendPurchase } from '@/lib/meta';

export async function POST(request) {
  try {
    const event = await getWebhookEvent(request);

    // Оплата вне Checkout: инвойс, ссылка на оплату старого образца, ручное
    // списание в кассе. Stripe присылает только payment_intent.succeeded, события
    // сессии нет — и такая оплата не долетала до бота вообще. Именно так прошла
    // оплата 8 сентября, которую никто не увидел.
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object || {};

      // В этом же аккаунте Stripe школа выставляет счета постоянным ученикам:
      // «Payment for Invoice» к пробным урокам отношения не имеет, и уведомлять
      // о нём менеджеров воронки — чистый шум. Оплаты через Checkout приезжают
      // отдельным событием сессии, дублировать их здесь тоже незачем.
      const orderRef = String((pi.payment_details && pi.payment_details.order_reference) || '');

      if (pi.invoice || orderRef.startsWith('in_') || orderRef.startsWith('cs_')) {
        return new Response('ok', { status: 200 });
      }
      const key = 'payment:pi_' + pi.id;
      const known = await kvGet(key);

      // Тот же платёж мог уже прийти событием сессии — тогда он записан
      // под ключом сессии, а идентификатор намерения лежит в поле pi.
      let duplicate = Boolean(known);

      if (!duplicate) {
        const keys = await kvKeys('payment:*');

        for (const k of keys) {
          const rec = await kvGet(k);

          if (rec && rec.pi && rec.pi === pi.id) { duplicate = true; break; }
        }
      }

      if (!duplicate) {
        const email = (pi.receipt_email)
          || (pi.charges && pi.charges.data && pi.charges.data[0] && pi.charges.data[0].billing_details && pi.charges.data[0].billing_details.email)
          || '';
        const label = pi.description || 'Оплата в Stripe';

        // Оплата пришла не по ссылке из бота, кода заявки в ней нет. Пробуем найти
        // человека по почте: иначе прямая оплата навсегда остаётся «без заявки»,
        // а рядом висит ручная отметка менеджера про ту же самую сумму.
        let matchedId = null;

        if (email) {
          try {
            const target = String(email).trim().toLowerCase();
            const bookingKeys = await kvKeys('booking:*');
            let best = null;

            for (const bk of bookingKeys) {
              const b = await kvGet(bk);

              if (!b || b.status === 'cancelled') continue;
              if (String(b.email || '').trim().toLowerCase() !== target) continue;
              if (!best || String(b.createdAt || '') > String(best.createdAt || '')) best = b;
            }

            if (best) {
              matchedId = best.id;

              // Человек заплатил картой, а в заявке стоит «мимо кассы»: так было,
              // пока вебхука не существовало и оплаты проводили руками. Чиним запись.
              await updateBooking(best.id, {
                paid: true,
                paidAt: best.paidAt || new Date().toISOString(),
                paidAmount: best.paidAmount || pi.amount_received || pi.amount || 0,
                paidCurrency: best.paidCurrency || pi.currency || 'eur',
                paidVia: 'stripe',
                paidPi: pi.id
              });
            }
          } catch (e) {
            console.error('Payment booking match error:', e);
          }
        }

        // Ни с одной заявкой платёж не сошёлся: значит, это не наша воронка,
        // а обычная оплата школы. Молча пропускаем — раньше бот присылал их все.
        if (!matchedId) {
          return new Response('ok', { status: 200 });
        }

        await kvSet(key, {
          at: new Date().toISOString(),
          bookingId: matchedId,
          pi: pi.id,
          email,
          label,
          amount: pi.amount_received || pi.amount || 0,
          currency: pi.currency || 'eur',
          via: 'Stripe'
        });

        await notifyManagers(
          '💰 <b>Оплата вне кассы бота</b> · Stripe\n' +
          (email ? email + '\n' : '') +
          label + ' — ' + Math.round(Number(pi.amount_received || pi.amount || 0) / 100) + ' ' +
          String(pi.currency || '').toUpperCase() + '\n' +
          'Привязано к заявке <code>' + matchedId + '</code> — оплата прямая, отмечать руками не нужно.'
        );
      }

      return new Response('ok', { status: 200 });
    }

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
                '💰 <b>Оплата</b> · Stripe\n' +
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

      // Запись об оплате в базе. Отчёт /payments собирается из них, а не из Stripe:
      // так видны и оплаты без кода заявки, и переводы мимо кассы.
      try {
        const sessionId = (event.data.object && event.data.object.id) || String(Date.now());

        await kvSet('payment:' + sessionId, {
          at: new Date().toISOString(),
          bookingId: bookingId || null,
          pi: (event.data.object && event.data.object.payment_intent) || null,
          email: purchaseData.email || '',
          label: purchaseData.label || pack || null,
          amount: purchaseData.amount || 0,
          currency: purchaseData.currency || 'eur',
          via: 'Stripe'
        });
      } catch (e) {
        console.error('Payment record error:', e);
      }

      // Оплата без кода заявки — человек платил с сайта, а не по ссылке из бота.
      // Раньше о такой оплате никто не узнавал: уведомление стояло внутри ветки с кодом.
      if (!bookingId) {
        try {
          await notifyManagers(
            '💰 <b>Оплата без заявки</b> · Stripe\n' +
            (purchaseData.email ? purchaseData.email + '\n' : '') +
            (purchaseData.label || pack || 'Пакет') + ' — ' +
            Math.round(Number(purchaseData.amount || 0) / 100) + ' ' +
            String(purchaseData.currency || '').toUpperCase() + '\n' +
            'Кода заявки нет — человек платил с сайта. Найти его: <code>/find почта</code>'
          );
        } catch (e) {
          console.error('Payment notification error:', e);
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
