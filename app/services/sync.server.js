import { getOrCreateShop } from "./shop.server";
import { syncProductUnits, deactivateProductUnits } from "./rental-unit.server";

const PRODUCT_QUERY = `#graphql
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      tags
      collections(first: 25) { nodes { handle } }
      variants(first: 100) {
        nodes {
          id
          title
          selectedOptions { name value }
          rentableQuantity: metafield(key: "rentable_quantity") {
            jsonValue
          }
        }
      }
    }
  }
`;

async function adminGraphql(admin, query, variables) {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  return body.data;
}

function isRentalProduct(node) {
  if (!node) return false;
  const tags = (node.tags || []).map((t) => t.toLowerCase());
  if (tags.includes("rental") || tags.includes("rent")) return true;
  const handles = (node.collections?.nodes || []).map((c) => (c.handle || "").toLowerCase());
  return handles.includes("rentals");
}

export async function syncOneProduct({ admin, shopDomain, productId }) {
  const shop = await getOrCreateShop(shopDomain);
  const gid = normalizeProductGid(productId);
  const data = await adminGraphql(admin, PRODUCT_QUERY, { id: gid });
  const p = data?.product;
  if (!p) return { skipped: true, reason: "not-found" };
  if (!isRentalProduct(p)) {
    await deactivateProductUnits(shop.id, gid);
    return { skipped: true, reason: "not-rental" };
  }
  await syncProductUnits({
    shopId: shop.id,
    productId: gid,
    productTitle: p.title,
    variants: p.variants?.nodes || [],
  });
  return { synced: true };
}

export async function markProductDeleted({ shopDomain, productId }) {
  const shop = await getOrCreateShop(shopDomain);
  const gid = normalizeProductGid(productId);
  await deactivateProductUnits(shop.id, gid);
  return { deactivated: true };
}

function normalizeProductGid(productId) {
  if (!productId) return null;
  const raw = String(productId);
  return raw.startsWith("gid://") ? raw : `gid://shopify/Product/${raw}`;
}
