import { authenticate, unauthenticated } from "../shopify.server";
import { syncOneProduct } from "../services/sync.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[webhook ${topic}] ${shop} product ${payload?.id}`);
  const productId = payload?.admin_graphql_api_id || (payload?.id ? `gid://shopify/Product/${payload.id}` : null);
  if (!productId) return new Response();
  try {
    const { admin } = await unauthenticated.admin(shop);
    await syncOneProduct({ admin, shopDomain: shop, productId });
  } catch (e) {
    console.error(`[webhook ${topic}] sync failed`, e);
  }
  return new Response();
};
