const ensuredShops = new Set();

const LOOKUP = `#graphql
  query RentableQuantityDefinition {
    metafieldDefinitions(first: 1, ownerType: PRODUCTVARIANT, namespace: "$app", key: "rentable_quantity") {
      nodes { id }
    }
  }
`;

const CREATE = `#graphql
  mutation EnsureRentableQuantityDefinition {
    metafieldDefinitionCreate(definition: {
      name: "Rentable quantity"
      namespace: "$app"
      key: "rentable_quantity"
      description: "How many of this variant can be rented at the same time. Leave empty to default to 1."
      type: "number_integer"
      ownerType: PRODUCTVARIANT
      access: { admin: MERCHANT_READ_WRITE }
      validations: [{ name: "min", value: "0" }]
    }) {
      createdDefinition { id }
      userErrors { field message }
    }
  }
`;

export async function ensureRentableQuantityDefinition(admin, shopDomain) {
  if (!admin) return;
  if (shopDomain && ensuredShops.has(shopDomain)) return;

  const existing = await adminGraphql(admin, LOOKUP);
  if (existing?.metafieldDefinitions?.nodes?.length) {
    if (shopDomain) ensuredShops.add(shopDomain);
    return;
  }

  const data = await adminGraphql(admin, CREATE);
  const errors = data?.metafieldDefinitionCreate?.userErrors || [];
  const alreadyExists = errors.some((e) => /already|taken|exists/i.test(e.message || ""));
  if (errors.length && !alreadyExists) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  if (shopDomain) ensuredShops.add(shopDomain);
}

async function adminGraphql(admin, query) {
  const res = await admin.graphql(query);
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  return body.data;
}
