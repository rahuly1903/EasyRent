import prisma from "../db.server";
import { addDaysUtc, todayUtc, toUtcMidnight } from "../lib/dates";
import { resolveRentableQuantity } from "../lib/rentable-quantity";
import { canBook, computeBlockWindow, resolveBuffers } from "./availability.server";
import { findUnit } from "./rental-unit.server";
import { getSettings } from "./shop.server";
import { toVariantGid } from "../lib/shopify-ids";
import { syncOneProduct } from "./sync.server";

export async function createBookingsFromOrder({
  shopId,
  order,
  topic = "ORDERS_CREATE",
  admin,
  shopDomain,
}) {
  const log = `[webhook ${topic}]`;
  if (!order?.orderId) {
    console.warn(`${log} no order id, cannot create bookings`);
    return { created: 0, skipped: 0, failed: 0 };
  }

  const items = order.lineItems || [];
  console.log(
    `${log} processing ${items.length} line item(s) for ${order.orderId} ${order.orderName || ""}`.trim(),
  );

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const syncedProducts = new Set();

  for (const li of items) {
    try {
      const props = parseLineItemProps(li.properties);
      const opts = parseVariantOptions([
        ...(li.selectedOptions || []),
        ...(Array.isArray(li.properties) ? li.properties : []),
      ]);
      if (isDepositLine(li, props)) {
        console.warn(`${log} skip line ${li.id}: security deposit`);
        skipped += 1;
        continue;
      }
      if (!props.rentalStart) {
        console.warn(`${log} skip line ${li.id}: no Rental Start`, summarizeProperties(li.properties));
        skipped += 1;
        continue;
      }
      if (!li.productId) {
        console.warn(`${log} skip line ${li.id}: no product id`);
        skipped += 1;
        continue;
      }
      if (!li.variantId) {
        console.warn(`${log} skip line ${li.id}: no variant id`);
        skipped += 1;
        continue;
      }

      if (admin && shopDomain && !syncedProducts.has(li.productId)) {
        syncedProducts.add(li.productId);
        try {
          const sync = await syncOneProduct({
            admin,
            shopDomain,
            productId: li.productId,
          });
          if (sync?.skipped && sync.reason === "not-rental") {
            console.warn(`${log} skip line ${li.id}: product is not a rental`);
            skipped += 1;
            continue;
          }
        } catch (e) {
          console.warn(`${log} product sync failed for ${li.productId}, using cached unit`, e);
        }
      }

      const duration =
        parseDurationValue(props.duration) ||
        parseDurationValue(opts.duration) ||
        parseDurationFromTitle(li.variantTitle) ||
        1;

      const result = await createBookingFromLineItem({
        shopId,
        productId: li.productId,
        duration,
        startDate: props.rentalStart,
        variantId: li.variantId,
        orderId: order.orderId,
        orderName: order.orderName,
        lineItemId: li.id ? String(li.id) : null,
        customerId: order.customerId,
        customerEmail: order.customerEmail,
      });

      if (result.skipped) {
        console.warn(`${log} skip line ${li.id}: ${result.reason || "not a rental"}`);
        skipped += 1;
      } else if (result.created) {
        console.log(
          `${log} created booking ${result.booking.id} line ${li.id} variant=${li.variantId} start=${props.rentalStart} days=${duration}`,
        );
        created += 1;
      } else {
        console.log(`${log} booking already exists ${result.booking.id} for line ${li.id}`);
        skipped += 1;
      }
    } catch (e) {
      failed += 1;
      console.error(`${log} booking create failed for line ${li?.id}`, e);
    }
  }

  console.log(`${log} done ${order.orderId} created=${created} skipped=${skipped} failed=${failed}`);
  return { created, skipped, failed };
}

export async function createBookingFromLineItem({
  shopId,
  productId,
  duration,
  startDate,
  variantId,
  orderId,
  orderName,
  lineItemId,
  customerId,
  customerEmail,
}) {
  if (orderId && lineItemId) {
    const existing = await prisma.booking.findFirst({
      where: { shopId, orderId, lineItemId },
    });
    if (existing) return { booking: existing, created: false };
  }

  const variantGid = toVariantGid(variantId);
  if (!variantGid) throw new Error(`Missing variant id for product ${productId}`);

  const unit = await findUnit({ shopId, productId, variantId: variantGid });
  if (!unit || !unit.active) {
    return { created: false, skipped: true, reason: "not-rental" };
  }
  const settings = await getSettings(shopId);
  const days = Math.max(1, Number(duration) || 1);
  const start = toUtcMidnight(startDate);
  if (!start) throw new Error("Invalid startDate");
  const end = addDaysUtc(start, days - 1);
  const { before, after } = resolveBuffers(unit, settings);
  const { blockStart, blockEnd } = computeBlockWindow({
    startDate: start,
    endDate: end,
    before,
    after,
  });

  const ok = await canBook({
    unitId: unit.id,
    blockStart,
    blockEnd,
    quantity: resolveRentableQuantity(unit.quantity),
  });
  if (!ok) throw new Error(`Overbooking: unit ${unit.id} at capacity for ${start.toISOString()}`);

  const booking = await prisma.booking.create({
    data: {
      shopId,
      rentalUnitId: unit.id,
      variantId: variantGid,
      orderId,
      orderName,
      lineItemId,
      customerId,
      customerEmail,
      startDate: start,
      endDate: end,
      blockStart,
      blockEnd,
      status: "pending",
    },
  });
  return { booking, created: true };
}

export async function setStatusByOrder(shopId, orderId, status) {
  return prisma.booking.updateMany({
    where: { shopId, orderId: { in: orderIdVariants(orderId) } },
    data: { status },
  });
}

export async function cancelByOrder(shopId, orderId) {
  return setStatusByOrder(shopId, orderId, "cancelled");
}

export async function markPaid(shopId, orderId) {
  return prisma.booking.updateMany({
    where: { shopId, orderId: { in: orderIdVariants(orderId) }, status: "pending" },
    data: { status: "confirmed" },
  });
}

export async function overrideBufferForBooking({ bookingId, before, after }) {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { rentalUnit: true },
  });
  if (!b) return null;
  const settings = await getSettings(b.shopId);
  const bfBefore = before ?? b.rentalUnit.bufferDaysBefore ?? settings.defaultBufferBefore ?? 0;
  const bfAfter = after ?? b.rentalUnit.bufferDaysAfter ?? settings.defaultBufferAfter ?? 0;
  const win = computeBlockWindow({
    startDate: b.startDate,
    endDate: b.endDate,
    before: bfBefore,
    after: bfAfter,
  });
  return prisma.booking.update({
    where: { id: bookingId },
    data: { blockStart: win.blockStart, blockEnd: win.blockEnd },
  });
}

export async function setBookingStatus(bookingId, status) {
  return prisma.booking.update({ where: { id: bookingId }, data: { status } });
}

export function bookingListWhere(shopId, tab) {
  const today = todayUtc();
  const tomorrow = addDaysUtc(today, 1);
  const in14 = addDaysUtc(today, 14);
  switch (tab) {
    case "deliveries":
      return {
        shopId,
        status: { in: ["pending", "confirmed"] },
        startDate: { gte: today, lt: tomorrow },
      };
    case "pickups":
      return {
        shopId,
        status: { in: ["confirmed", "out"] },
        endDate: { gte: today, lt: tomorrow },
      };
    case "overdue":
      return {
        shopId,
        status: { in: ["confirmed", "out"] },
        endDate: { lt: today },
      };
    case "upcoming":
      return {
        shopId,
        status: { in: ["pending", "confirmed"] },
        startDate: { gte: tomorrow, lt: in14 },
      };
    case "all":
    default:
      return { shopId };
  }
}

export async function listBookingsPage({ shopId, tab, page = 1, pageSize = 10 }) {
  const where = bookingListWhere(shopId, tab);
  const safePage = Math.max(1, Number(page) || 1);
  const take = Math.max(1, Number(pageSize) || 10);
  const orderBy =
    tab === "pickups" || tab === "overdue" ? { endDate: "asc" } : { startDate: "asc" };
  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: { rentalUnit: true },
      orderBy,
      take,
      skip: (safePage - 1) * take,
    }),
    prisma.booking.count({ where }),
  ]);
  return {
    bookings,
    total,
    page: safePage,
    pageSize: take,
    totalPages: Math.max(1, Math.ceil(total / take)),
  };
}

export async function dashboardBuckets(shopId) {
  const [deliveries, pickups, overdue, upcoming] = await Promise.all([
    prisma.booking.findMany({
      where: bookingListWhere(shopId, "deliveries"),
      include: { rentalUnit: true },
      orderBy: { startDate: "asc" },
    }),
    prisma.booking.findMany({
      where: bookingListWhere(shopId, "pickups"),
      include: { rentalUnit: true },
      orderBy: { endDate: "asc" },
    }),
    prisma.booking.findMany({
      where: bookingListWhere(shopId, "overdue"),
      include: { rentalUnit: true },
      orderBy: { endDate: "asc" },
    }),
    prisma.booking.findMany({
      where: bookingListWhere(shopId, "upcoming"),
      include: { rentalUnit: true },
      orderBy: { startDate: "asc" },
    }),
  ]);
  return { deliveries, pickups, overdue, upcoming };
}

export function parseLineItemProps(properties) {
  const map = attributesToMap(properties);
  return {
    rentalStart: map["rental start"] || map["rentalstart"] || map["rental_start"] || null,
    rentalEnd: map["rental end"] || map["rentalend"] || map["rental_end"] || null,
    duration: map["duration"] || map["rent for"] || map["rentfor"] || null,
    deposit: map["deposit"] || null,
  };
}

function isDepositLine(lineItem, props) {
  if (String(props?.deposit || "").toLowerCase() === "true") return true;
  const title = `${lineItem?.title || ""} ${lineItem?.variantTitle || ""}`.toLowerCase();
  return title.includes("security deposit");
}

export function parseVariantOptions(variantOptions) {
  const map = attributesToMap(variantOptions);
  return {
    duration: map["duration"] || map["rent for"] || map["rentfor"] || null,
  };
}

export function parseDurationFromTitle(title) {
  if (!title) return null;
  const match = /(\d+)\s*-?\s*day/i.exec(title);
  return match ? Number(match[1]) : null;
}

function parseDurationValue(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const match = /(\d+)/.exec(String(value));
  return match ? Number(match[1]) : null;
}

function attributesToMap(properties) {
  const map = {};
  if (!properties) return map;
  if (Array.isArray(properties)) {
    for (const item of properties) {
      if (!item) continue;
      const name = normalizeAttrName(item.name || item.key);
      if (name) map[name] = item.value;
    }
    return map;
  }
  if (typeof properties === "object") {
    for (const [key, value] of Object.entries(properties)) {
      const name = normalizeAttrName(key);
      if (name) map[name] = value;
    }
  }
  return map;
}

function normalizeAttrName(name) {
  return (name || "")
    .toString()
    .toLowerCase()
    .replace(/^_/, "")
    .trim();
}

function summarizeProperties(properties) {
  if (!properties) return [];
  if (Array.isArray(properties)) {
    return properties.map((item) => item?.name || item?.key).filter(Boolean);
  }
  if (typeof properties === "object") return Object.keys(properties);
  return [];
}

function orderIdVariants(orderId) {
  if (!orderId) return [];
  const ids = [String(orderId)];
  const match = /gid:\/\/shopify\/Order\/(\d+)/.exec(String(orderId));
  if (match) ids.push(match[1]);
  return [...new Set(ids)];
}
