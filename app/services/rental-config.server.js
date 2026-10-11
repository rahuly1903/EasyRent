import prisma from "../db.server";
import { quantityFromVariantNode } from "../lib/rentable-quantity";
import {
  metafieldPayload,
  normalizeRentalSettings,
} from "../lib/rental-settings";
import { toProductGid } from "../lib/shopify-ids";
import { syncProductUnits, deactivateProductUnits } from "./rental-unit.server";

const RENT_FOR_NAME = /rent\s*for|duration/i;
const DAY_VALUE = /(\d+)\s*-?\s*days?/i;
const MAX_PRODUCTS = 50;
const METAFIELD_BATCH = 25;

const PRODUCTS_BY_ID = `#graphql
  query RentalProductsById($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        featuredImage {
          url
        }
        variants(first: 100) {
          nodes {
            id
            title
            selectedOptions {
              name
              value
            }
            rentableQuantity: metafield(key: "rentable_quantity") {
              jsonValue
            }
          }
        }
      }
    }
  }
`;

const SET_METAFIELDS = `#graphql
  mutation SetRentalSettings($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

const DELETE_METAFIELDS = `#graphql
  mutation DeleteRentalSettings($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key ownerId }
      userErrors { field message }
    }
  }
`;

export async function dashboardStats(shopId) {
  const now = new Date();
  const thirtyAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [recent, bookingsThisMonth] = await Promise.all([
    prisma.booking.findMany({
      where: {
        shopId,
        status: { not: "cancelled" },
        createdAt: { gte: thirtyAgo },
      },
      select: {
        orderId: true,
        rentalUnit: { select: { productId: true } },
      },
    }),
    prisma.booking.count({
      where: {
        shopId,
        status: { not: "cancelled" },
        startDate: { gte: monthStart, lt: nextMonth },
      },
    }),
  ]);

  const orders = new Set(recent.map((row) => row.orderId).filter(Boolean));
  const products = new Set(recent.map((row) => row.rentalUnit?.productId).filter(Boolean));
  return {
    ordersMade: orders.size,
    productsBooked: products.size,
    bookingsThisMonth,
  };
}

export async function listLinkedProducts({ shopId, q, sort, page, pageSize }) {
  const query = String(q || "").trim();
  const where = {
    shopId,
    active: true,
    ...(query
      ? { productTitle: { contains: query, mode: "insensitive" } }
      : {}),
  };
  const orderBy =
    sort === "oldest"
      ? { updatedAt: "asc" }
      : sort === "title"
        ? { productTitle: "asc" }
        : { updatedAt: "desc" };
  const safePage = Math.max(1, Number(page) || 1);
  const take = Math.max(1, Number(pageSize) || 20);
  const [rows, total] = await Promise.all([
    prisma.productRentalConfig.findMany({
      where,
      orderBy,
      take,
      skip: (safePage - 1) * take,
    }),
    prisma.productRentalConfig.count({ where }),
  ]);
  return {
    rows,
    total,
    page: safePage,
    pageSize: take,
    totalPages: Math.max(1, Math.ceil(total / take)),
  };
}

export async function configsForProducts(shopId, productIds) {
  const ids = uniqueProductIds(productIds);
  if (!ids.length) return [];
  return prisma.productRentalConfig.findMany({
    where: { shopId, productId: { in: ids } },
  });
}

export async function saveLinkedProducts({ admin, shopId, productIds, settings }) {
  const ids = uniqueProductIds(productIds);
  if (!ids.length) throw new Error("Select at least one product");
  if (ids.length > MAX_PRODUCTS) throw new Error(`Select up to ${MAX_PRODUCTS} products at a time`);
  const normalized = normalizeRentalSettings(settings);
  const products = await fetchProducts(admin, ids);
  if (!products.length) throw new Error("Selected products could not be loaded");

  const saved = [];
  for (const product of products) {
    const variants = product.variants?.nodes || [];
    const row = await prisma.productRentalConfig.upsert({
      where: { shopId_productId: { shopId, productId: product.id } },
      create: {
        shopId,
        productId: product.id,
        ...snapshot(product, variants),
        ...persistedSettings(normalized),
        active: true,
      },
      update: {
        ...snapshot(product, variants),
        ...persistedSettings(normalized),
        active: true,
      },
    });
    saved.push(row);
    await syncProductUnits({
      shopId,
      productId: product.id,
      productTitle: product.title,
      variants,
    });
  }

  await writeMetafields(admin, saved.map((row) => row.productId), normalized);
  return saved;
}

export async function unlinkProducts({ admin, shopId, productIds }) {
  const ids = uniqueProductIds(productIds);
  if (!ids.length) return [];
  await prisma.productRentalConfig.updateMany({
    where: { shopId, productId: { in: ids } },
    data: { active: false },
  });
  for (const id of ids) {
    await deactivateProductUnits(shopId, id);
  }
  await deleteMetafields(admin, ids);
  return ids;
}

export async function deactivateUnlinkedUnits(shopId) {
  const linked = await prisma.productRentalConfig.findMany({
    where: { shopId, active: true },
    select: { productId: true },
  });
  const ids = linked.map((row) => row.productId);
  if (!ids.length) {
    await prisma.rentalUnit.updateMany({
      where: { shopId, active: true },
      data: { active: false },
    });
    return;
  }
  await prisma.rentalUnit.updateMany({
    where: { shopId, active: true, productId: { notIn: ids } },
    data: { active: false },
  });
}

export function durationLabelsFromVariants(variants) {
  const labels = [];
  const seen = new Set();
  for (const variant of variants || []) {
    for (const option of variant.selectedOptions || []) {
      const named = RENT_FOR_NAME.test(option.name || "");
      const day = DAY_VALUE.exec(option.value || "");
      if (!named && !day) continue;
      const numeric = day || (named ? /^(\d+)$/.exec(String(option.value || "").trim()) : null);
      if (!numeric || seen.has(numeric[1])) continue;
      seen.add(numeric[1]);
      labels.push(numeric[1]);
    }
  }
  return labels.sort((a, b) => Number(a) - Number(b));
}

export function stockFromVariants(variants) {
  const nodes = variants || [];
  if (!nodes.length) return 1;
  return nodes.reduce((sum, variant) => sum + quantityFromVariantNode(variant), 0);
}

function snapshot(product, variants) {
  return {
    productTitle: product.title || null,
    productHandle: product.handle || null,
    productImage: product.featuredImage?.url || null,
    durationLabels: durationLabelsFromVariants(variants),
    stock: stockFromVariants(variants),
  };
}

function persistedSettings(settings) {
  return {
    bookingType: settings.bookingType,
    blockDates: settings.blockDates,
    calendarStartDays: settings.calendarStartDays,
    calendarEndDays: settings.calendarEndDays,
    weekdays: settings.weekdays,
    depositAmount: settings.depositAmount,
    depositPercent: settings.depositPercent,
  };
}

async function fetchProducts(admin, ids) {
  const data = await adminGraphql(admin, PRODUCTS_BY_ID, { ids });
  return (data?.nodes || []).filter((node) => node?.id);
}

async function writeMetafields(admin, productIds, settings) {
  const value = JSON.stringify(metafieldPayload(settings));
  for (let i = 0; i < productIds.length; i += METAFIELD_BATCH) {
    const metafields = productIds.slice(i, i + METAFIELD_BATCH).map((ownerId) => ({
      ownerId,
      key: "rental_settings",
      type: "json",
      value,
    }));
    const data = await adminGraphql(admin, SET_METAFIELDS, { metafields });
    const errors = data?.metafieldsSet?.userErrors || [];
    if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  }
}

async function deleteMetafields(admin, productIds) {
  for (let i = 0; i < productIds.length; i += METAFIELD_BATCH) {
    const metafields = productIds.slice(i, i + METAFIELD_BATCH).map((ownerId) => ({
      ownerId,
      namespace: "$app",
      key: "rental_settings",
    }));
    const data = await adminGraphql(admin, DELETE_METAFIELDS, { metafields });
    const errors = data?.metafieldsDelete?.userErrors || [];
    const missing = errors.filter((error) => /not exist|not found/i.test(error.message || ""));
    if (errors.length && missing.length !== errors.length) {
      throw new Error(errors.map((error) => error.message).join("; "));
    }
  }
}

function uniqueProductIds(productIds) {
  const ids = [];
  const seen = new Set();
  for (const id of productIds || []) {
    const gid = toProductGid(id);
    if (!gid || seen.has(gid)) continue;
    seen.add(gid);
    ids.push(gid);
  }
  return ids;
}

async function adminGraphql(admin, query, variables) {
  const res = await admin.graphql(query, { variables });
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }
  return body.data;
}
