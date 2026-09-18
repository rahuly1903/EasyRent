const ensuredShops = new Set();
const DEPOSIT_HANDLE = "refundable-security-deposit";
const DEPOSIT_TITLE = "Refundable Security deposit";

const SETUP_QUERY = `#graphql
  query DepositSetup {
    shop {
      id
      depositVariant: metafield(key: "deposit_variant") {
        jsonValue
      }
    }
    products(first: 1, query: "handle:refundable-security-deposit") {
      nodes {
        id
        variants(first: 1) {
          nodes {
            id
          }
        }
      }
    }
  }
`;

const VARIANT_QUERY = `#graphql
  query DepositVariant($id: ID!) {
    productVariant(id: $id) {
      id
    }
  }
`;

const CREATE_PRODUCT = `#graphql
  mutation CreateDepositProduct($productSet: ProductSetInput!, $synchronous: Boolean) {
    productSet(synchronous: $synchronous, input: $productSet) {
      product {
        id
        variants(first: 1) {
          nodes {
            id
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SET_METAFIELDS = `#graphql
  mutation SetDepositVariant($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        jsonValue
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function ensureRentalDepositSetup(admin, shopDomain) {
  if (!admin) return;
  if (shopDomain && ensuredShops.has(shopDomain)) return;

  const setup = await adminGraphql(admin, SETUP_QUERY);
  const shopId = setup?.shop?.id;
  if (!shopId) return;

  const variantId = await resolveDepositVariantId(admin, setup);
  if (!variantId) {
    throw new Error("Could not create security deposit product");
  }

  await setShopDepositVariant(admin, shopId, variantId);
  // Cart Transform (Shopify Function) is not registered: custom apps can only
  // activate functions on Shopify Plus or development stores.

  if (shopDomain) ensuredShops.add(shopDomain);
}

async function resolveDepositVariantId(admin, setup) {
  const existingId = gidFromJson(setup?.shop?.depositVariant?.jsonValue);
  if (existingId) {
    const live = await adminGraphql(admin, VARIANT_QUERY, { id: existingId });
    if (live?.productVariant?.id) return live.productVariant.id;
  }

  const fromHandle = setup?.products?.nodes?.[0]?.variants?.nodes?.[0]?.id;
  if (fromHandle) return fromHandle;

  return createDepositProduct(admin);
}

async function createDepositProduct(admin) {
  const data = await adminGraphql(admin, CREATE_PRODUCT, {
    synchronous: true,
    productSet: {
      title: DEPOSIT_TITLE,
      handle: DEPOSIT_HANDLE,
      status: "DRAFT",
      productType: "Rental Deposit",
      vendor: "EasyRent",
      productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
      variants: [ 
        {
          optionValues: [{ optionName: "Title", name: "Default Title" }],
          price: 0,
          inventoryPolicy: "CONTINUE",
          inventoryItem: {
            tracked: false,
            requiresShipping: false,
            sku: "RENTAL-SECURITY-DEPOSIT",
          },
        },
      ],
    },
  });
  const errors = data?.productSet?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  return data?.productSet?.product?.variants?.nodes?.[0]?.id || null;
}

async function setShopDepositVariant(admin, shopId, variantId) {
  const data = await adminGraphql(admin, SET_METAFIELDS, {
    metafields: [
      {
        ownerId: shopId,
        key: "deposit_variant",
        type: "variant_reference",
        value: variantId,
      },
    ],
  });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
}

function gidFromJson(value) {
  if (typeof value === "string" && value.includes("ProductVariant/")) return value;
  if (value && typeof value === "object" && value.id) return String(value.id);
  return null;
}

async function adminGraphql(admin, query, variables) {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  return body.data;
}
