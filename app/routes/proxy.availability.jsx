import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { getBlockedRangesForUnit, resolveBuffers } from "../services/availability.server";
import { findUnit } from "../services/rental-unit.server";
import { getSettings } from "../services/shop.server";
import { syncOneProduct } from "../services/sync.server";
import { resolveRentableQuantity } from "../lib/rentable-quantity";
import { todayUtc } from "../lib/dates";
import { toProductGid, toVariantGid } from "../lib/shopify-ids";

export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const productIdRaw = url.searchParams.get("productId") || url.searchParams.get("product_id");
  const variantIdRaw = url.searchParams.get("variantId") || url.searchParams.get("variant_id");
  const shopDomain = url.searchParams.get("shop");

  if (!productIdRaw || !variantIdRaw || !shopDomain) {
    return json({ ranges: [], error: "missing-params" }, 400);
  }

  const productId = toProductGid(productIdRaw);
  const variantId = toVariantGid(variantIdRaw);
  if (!productId || !variantId) {
    return json({ ranges: [], error: "missing-params" }, 400);
  }

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return json({ ranges: [] });

  let unit = await findUnit({ shopId: shop.id, productId, variantId });
  if (!unit) {
    try {
      const { admin } = await unauthenticated.admin(shopDomain);
      await syncOneProduct({ admin, shopDomain, productId });
      unit = await findUnit({ shopId: shop.id, productId, variantId });
    } catch (e) {
      console.warn("[availability] lazy sync failed", e);
    }
  }

  if (!unit || !unit.active) return json({ ranges: [] });

  const settings = await getSettings(shop.id);
  const { before, after } = resolveBuffers(unit, settings);
  const quantity = resolveRentableQuantity(unit.quantity);
  const ranges = await getBlockedRangesForUnit({
    unit,
    settings,
    fromDate: todayUtc(),
  });
  return json({
    quantity,
    ranges,
    bufferBefore: before,
    bufferAfter: after,
  });
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
