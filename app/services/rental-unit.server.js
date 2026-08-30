import prisma from "../db.server";
import { quantityFromVariantNode } from "../lib/rentable-quantity";
import { idsMatch, toProductGid, toVariantGid } from "../lib/shopify-ids";

function variantTitleFrom(variant) {
  if (variant?.title && variant.title !== "Default Title") return variant.title;
  return null;
}

// One rental unit per Shopify variant so each SKU has its own calendar.
export function deriveUnitsFromVariants(variants) {
  if (!variants || variants.length === 0) return [];
  const units = [];
  const seen = new Set();
  for (const v of variants) {
    const variantId = toVariantGid(v.id);
    if (!variantId || seen.has(variantId)) continue;
    seen.add(variantId);
    units.push({
      variantId,
      variantTitle: variantTitleFrom(v),
      quantity: quantityFromVariantNode(v),
    });
  }
  return units;
}

export async function syncProductUnits({ shopId, productId, productTitle, variants }) {
  const productGid = toProductGid(productId);
  const derived = deriveUnitsFromVariants(variants);
  const created = [];
  const keepVariantIds = derived.map((u) => u.variantId);

  for (const u of derived) {
    const unit = await prisma.rentalUnit.upsert({
      where: {
        shopId_productId_variantId: {
          shopId,
          productId: productGid,
          variantId: u.variantId,
        },
      },
      update: {
        productTitle,
        variantTitle: u.variantTitle,
        quantity: u.quantity,
        active: true,
      },
      create: {
        shopId,
        productId: productGid,
        productTitle,
        variantId: u.variantId,
        variantTitle: u.variantTitle,
        quantity: u.quantity,
        active: true,
      },
    });
    created.push(unit);
  }

  if (keepVariantIds.length) {
    await prisma.rentalUnit.updateMany({
      where: {
        shopId,
        productId: productGid,
        variantId: { notIn: keepVariantIds },
      },
      data: { active: false },
    });
  }

  if (productTitle) {
    await prisma.rentalUnit.updateMany({
      where: { shopId, productId: productGid },
      data: { productTitle },
    });
  }

  await rematchBookingsToVariantUnits({ shopId, productId: productGid, units: created });
  return created;
}

async function rematchBookingsToVariantUnits({ shopId, productId, units }) {
  if (!units.length) return;
  const bookings = await prisma.booking.findMany({
    where: {
      shopId,
      rentalUnit: { productId },
      variantId: { not: null },
    },
    select: { id: true, variantId: true, rentalUnitId: true },
  });
  for (const b of bookings) {
    const target = units.find((u) => idsMatch(u.variantId, b.variantId));
    if (target && target.id !== b.rentalUnitId) {
      await prisma.booking.update({
        where: { id: b.id },
        data: { rentalUnitId: target.id },
      });
    }
  }
}

export async function deactivateProductUnits(shopId, productId) {
  await prisma.rentalUnit.updateMany({
    where: { shopId, productId: toProductGid(productId) },
    data: { active: false },
  });
}

export async function findUnit({ shopId, productId, variantId }) {
  const productGid = toProductGid(productId);
  const variantGid = toVariantGid(variantId);
  if (!productGid || !variantGid) return null;

  const exact = await prisma.rentalUnit.findFirst({
    where: { shopId, productId: productGid, variantId: variantGid },
  });
  if (exact) return exact;

  const units = await prisma.rentalUnit.findMany({
    where: { shopId, productId: productGid },
  });
  return units.find((u) => idsMatch(u.variantId, variantGid)) || null;
}
