import { getOrCreateShop } from "./shop.server";
import { syncProductUnits, deactivateProductUnits } from "./rental-unit.server";
import prisma from "../db.server";

export const RENT_TAG = "rent";

const PRODUCT_QUERY = `#graphql
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      tags
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

const RENT_UNITS_QUERY = `#graphql
  query RentTaggedProductUnits($cursor: String) {
    products(first: 250, query: "tag:rent", after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        variantsCount {
          count
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

export function isRentalProduct(node) {
  if (!node) return false;
  return (node.tags || []).some((tag) => String(tag).toLowerCase() === RENT_TAG);
}

export async function countActiveRentalUnits(admin, shopId) {
  if (!admin) return 0;

  let cursor = null;
  let total = 0;
  const rentProductIds = [];

  do {
    const data = await adminGraphql(
      admin,
      RENT_UNITS_QUERY,
      cursor ? { cursor } : { cursor: null },
    );
    const connection = data?.products;
    for (const node of connection?.nodes || []) {
      if (node?.id) rentProductIds.push(node.id);
      const n = Number(node?.variantsCount?.count);
      total += Number.isFinite(n) ? n : 0;
    }
    cursor = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);

  if (shopId) {
    await deactivateUnitsNotIn(shopId, rentProductIds);
  }

  return total;
}

async function deactivateUnitsNotIn(shopId, productIds) {
  if (!productIds.length) {
    await prisma.rentalUnit.updateMany({
      where: { shopId, active: true },
      data: { active: false },
    });
    return;
  }
  await prisma.rentalUnit.updateMany({
    where: {
      shopId,
      active: true,
      productId: { notIn: productIds },
    },
    data: { active: false },
  });
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
