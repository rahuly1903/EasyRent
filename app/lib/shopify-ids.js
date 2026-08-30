export function toGid(type, id) {
  if (id == null || id === "") return null;
  const value = String(id);
  if (value.startsWith("gid://")) return value;
  return `gid://shopify/${type}/${value}`;
}

export function toProductGid(productId) {
  return toGid("Product", productId);
}

export function toVariantGid(variantId) {
  return toGid("ProductVariant", variantId);
}

export function idTail(id) {
  if (id == null || id === "") return "";
  const value = String(id);
  const match = /\/(\d+)\s*$/.exec(value);
  return match ? match[1] : value;
}

export function idsMatch(a, b) {
  return Boolean(a && b && idTail(a) === idTail(b));
}
