import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../services/shop.server";
import { cancelByOrder } from "../services/booking.server";
import { orderGidFromPayload } from "../services/order-webhook.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  const orderId = orderGidFromPayload(payload);
  console.log(`[webhook ${topic}] received`, {
    shop,
    payloadId: payload?.id ?? null,
    refundOrderId: payload?.order_id ?? null,
    orderId,
  });

  try {
    if (!orderId) {
      console.warn(`[webhook ${topic}] missing order id`);
      return new Response();
    }
    const shopRow = await getOrCreateShop(shop);
    const result = await cancelByOrder(shopRow.id, orderId);
    console.log(`[webhook ${topic}] cancelled ${result.count} booking(s) for ${orderId}`);
    return new Response();
  } catch (e) {
    console.error(`[webhook ${topic}] failed`, e);
    return new Response("Webhook processing failed", { status: 500 });
  }
};
