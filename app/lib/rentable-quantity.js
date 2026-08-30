// Empty / unset metafield → 1. Explicit 0 stays 0 (not rentable).

export function resolveRentableQuantity(raw) {
  if (raw == null || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.floor(n);
}

export function quantityFromVariantNode(variant) {
  return resolveRentableQuantity(variant?.rentableQuantity?.jsonValue);
}
