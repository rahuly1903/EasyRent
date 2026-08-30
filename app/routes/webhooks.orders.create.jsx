import { authenticate, unauthenticated } from "../shopify.server";
import { getOrCreateShop } from "../services/shop.server";
import { createBookingsFromOrder } from "../services/booking.server";
import {
  fetchOrderForBooking,
  mergeOrderSources,
  normalizeRestOrder,
  orderGidFromPayload,
} from "../services/order-webhook.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  const orderGid = orderGidFromPayload(payload);
  console.log(`[webhook ${topic}] received`, {
    shop,
    payloadId: payload?.id ?? null,
    orderGid,
    restLineItems: Array.isArray(payload?.line_items) ? payload.line_items.length : 0,
  });

  try {
    const shopRow = await getOrCreateShop(shop);
    const restOrder = normalizeRestOrder(payload);

    let admin = null;
    let gqlOrder = null;
    try {
      ({ admin } = await unauthenticated.admin(shop));
    } catch (e) {
      console.warn(`[webhook ${topic}] admin session unavailable`, e);
    }

    if (admin && orderGid) {
      try {
        gqlOrder = await fetchOrderForBooking(admin, orderGid);
        console.log(`[webhook ${topic}] GraphQL order`, {
          id: gqlOrder?.orderId ?? null,
          name: gqlOrder?.orderName ?? null,
          email: gqlOrder?.customerEmail ?? null,
          lineItems: gqlOrder?.lineItems?.length ?? 0,
        });
      } catch (e) {
        console.warn(`[webhook ${topic}] GraphQL fetch failed, using webhook payload`, e);
      }
    }

    const order = mergeOrderSources(gqlOrder, restOrder);
    if (!order) {
      console.warn(`[webhook ${topic}] no order data after merge`);
      return new Response();
    }

    await createBookingsFromOrder({
      shopId: shopRow.id,
      order,
      topic,
      admin,
      shopDomain: shop,
    });
    return new Response();
  } catch (e) {
    console.error(`[webhook ${topic}] failed`, e);
    return new Response("Webhook processing failed", { status: 500 });
  }
};
