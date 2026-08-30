import prisma from "../db.server";
import { resolveRentableQuantity } from "../lib/rentable-quantity";
import { addDaysUtc, todayUtc, toUtcMidnight, ymd } from "../lib/dates";

export function resolveBuffers(unit, settings) {
  return {
    before: unit?.bufferDaysBefore ?? settings?.defaultBufferBefore ?? 0,
    after: unit?.bufferDaysAfter ?? settings?.defaultBufferAfter ?? 0,
  };
}

export function computeBlockWindow({ startDate, endDate, before, after }) {
  const start = toUtcMidnight(startDate);
  const end = toUtcMidnight(endDate);
  return {
    startDate: start,
    endDate: end,
    blockStart: addDaysUtc(start, -Math.max(0, before | 0)),
    blockEnd: addDaysUtc(end, Math.max(0, after | 0)),
  };
}

// Sweep-line: over active bookings' [blockStart, blockEnd] inclusive intervals,
// return blocked-date ranges where concurrent booking count >= quantity.
export function computeBlockedRanges({ bookings, quantity, fromDate }) {
  const cap = resolveRentableQuantity(quantity);
  const floorDate = toUtcMidnight(fromDate) ?? todayUtc();
  if (cap < 1) {
    return [{ from: ymd(floorDate), to: "2099-12-31" }];
  }

  const events = [];
  for (const b of bookings) {
    events.push({ t: toUtcMidnight(b.blockStart).getTime(), d: +1 });
    // +1 day so end date is inclusive.
    events.push({ t: addDaysUtc(b.blockEnd, 1).getTime(), d: -1 });
  }
  events.sort((a, b) => a.t - b.t || a.d - b.d);

  const ranges = [];
  let active = 0;
  let blockedFrom = null;
  const floor = floorDate.getTime();

  for (const e of events) {
    const wasBlocked = active >= cap;
    active += e.d;
    const isBlocked = active >= cap;
    if (!wasBlocked && isBlocked) {
      blockedFrom = e.t;
    } else if (wasBlocked && !isBlocked) {
      const from = Math.max(blockedFrom, floor);
      const to = e.t - 86400000; // inclusive last blocked day
      if (to >= from) {
        ranges.push({ from: ymd(new Date(from)), to: ymd(new Date(to)) });
      }
      blockedFrom = null;
    }
  }
  return ranges;
}

export async function getBlockedRangesForUnit({ unit, settings, fromDate }) {
  const from = toUtcMidnight(fromDate) ?? todayUtc();
  const cap = resolveRentableQuantity(unit.quantity);
  const bookings = await prisma.booking.findMany({
    where: {
      rentalUnitId: unit.id,
      status: { not: "cancelled" },
      blockEnd: { gte: from },
    },
    select: { blockStart: true, blockEnd: true },
  });
  return computeBlockedRanges({
    bookings,
    quantity: cap,
    fromDate: from,
  });
}

// Returns true when existing occupancy on [blockStart..blockEnd] is still below quantity.
// Do not include the candidate booking: occupancy == quantity after a successful book is allowed.
export async function canBook({ unitId, blockStart, blockEnd, quantity, excludeBookingId }) {
  const bs = toUtcMidnight(blockStart);
  const be = toUtcMidnight(blockEnd);
  const cap = resolveRentableQuantity(quantity);
  if (cap < 1) return false;
  const overlapping = await prisma.booking.findMany({
    where: {
      rentalUnitId: unitId,
      status: { not: "cancelled" },
      blockStart: { lte: be },
      blockEnd: { gte: bs },
      ...(excludeBookingId ? { NOT: { id: excludeBookingId } } : {}),
    },
    select: { blockStart: true, blockEnd: true },
  });
  const blocked = computeBlockedRanges({
    bookings: overlapping,
    quantity: cap,
    fromDate: bs,
  });
  const bsMs = bs.getTime();
  const beMs = be.getTime();
  for (const r of blocked) {
    const fMs = new Date(r.from + "T00:00:00Z").getTime();
    const tMs = new Date(r.to + "T00:00:00Z").getTime();
    if (fMs <= beMs && tMs >= bsMs) return false;
  }
  return true;
}
