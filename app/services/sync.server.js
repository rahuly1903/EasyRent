import { getOrCreateShop } from "./shop.server";
import { syncProductUnits, deactivateProductUnits } from "./rental-unit.server";
import { durationLabelsFromVariants, stockFromVariants } from "./rental-config.server";
import prisma from "../db.server";

const PRODUCT_QUERY = `#graphql
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      featuredImage { url }
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

export async function countActiveRentalUnits(_admin, shopId) {
  if (!shopId) return 0;
  return prisma.rentalUnit.count({ where: { shopId, active: true } });
}

async function activeConfig(shopId, productId) {
  return prisma.productRentalConfig.findFirst({
    where: { shopId, productId, active: true },
  });
}

export async function syncOneProduct({ admin, shopDomain, productId }) {
  const shop = await getOrCreateShop(shopDomain);
  const gid = normalizeProductGid(productId);
  const linked = await activeConfig(shop.id, gid);
  if (!linked) return { skipped: true, reason: "not-rental" };

  const data = await adminGraphql(admin, PRODUCT_QUERY, { id: gid });
  const p = data?.product;
  if (!p) {
    await deactivateProductUnits(shop.id, gid);
    await prisma.productRentalConfig.updateMany({
      where: { shopId: shop.id, productId: gid },
      data: { active: false },
    });
    return { skipped: true, reason: "not-found" };
  }

  const variants = p.variants?.nodes || [];
  await syncProductUnits({
    shopId: shop.id,
    productId: gid,
    productTitle: p.title,
    variants,
  });
  await prisma.productRentalConfig.update({
    where: { shopId_productId: { shopId: shop.id, productId: gid } },
    data: {
      productTitle: p.title || null,
      productHandle: p.handle || null,
      productImage: p.featuredImage?.url || null,
      durationLabels: durationLabelsFromVariants(variants),
      stock: stockFromVariants(variants),
    },
  });
  return { synced: true };
}

export async function markProductDeleted({ shopDomain, productId }) {
  const shop = await getOrCreateShop(shopDomain);
  const gid = normalizeProductGid(productId);
  await deactivateProductUnits(shop.id, gid);
  await prisma.productRentalConfig.updateMany({
    where: { shopId: shop.id, productId: gid },
    data: { active: false },
  });
  return { deactivated: true };
}

function normalizeProductGid(productId) {
  if (!productId) return null;
  const raw = String(productId);
  return raw.startsWith("gid://") ? raw : `gid://shopify/Product/${raw}`;
}
