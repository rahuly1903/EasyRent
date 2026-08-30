import { authenticate } from "../shopify.server";
import { markProductDeleted } from "../services/sync.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[webhook ${topic}] ${shop} product ${payload?.id}`);
  const productId = payload?.admin_graphql_api_id || (payload?.id ? `gid://shopify/Product/${payload.id}` : null);
  if (!productId) return new Response();
  try {
    await markProductDeleted({ shopDomain: shop, productId });
  } catch (e) {
    console.error(`[webhook ${topic}] deactivate failed`, e);
  }
  return new Response();
};
