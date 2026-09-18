// @ts-check

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 * @typedef {import("../generated/api").Operation} Operation
 */

const DEFAULT_DEPOSIT_RATIO = 0.7;
const DEPOSIT_PROPERTY_KEY = "Refundable Security deposit";

/**
 * @type {CartTransformRunResult}
 */
const NO_CHANGES = {
  operations: [],
};

/**
 * Expand rental lines into the garment plus a refundable security deposit.
 * Deposit amount comes from the product metafield, or 70% of the rental
 * unit price rounded to the nearest whole currency unit.
 *
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const depositVariantId = gidFromJson(input.shop?.depositVariant?.jsonValue);
  if (!depositVariantId) return NO_CHANGES;

  const presentmentRate = Number(input.presentmentCurrencyRate || 1);
  const rate = Number.isFinite(presentmentRate) && presentmentRate > 0 ? presentmentRate : 1;

  const operations = input.cart.lines.reduce(
    /** @param {Operation[]} acc */
    (acc, line) => {
      const operation = buildExpandOperation(line, depositVariantId, rate);
      if (operation) acc.push({ lineExpand: operation });
      return acc;
    },
    [],
  );

  return operations.length > 0 ? { operations } : NO_CHANGES;
}

/**
 * @param {CartTransformRunInput["cart"]["lines"][number]} line
 * @param {string} depositVariantId
 * @param {number} presentmentRate
 */
function buildExpandOperation(line, depositVariantId, presentmentRate) {
  if (line.sellingPlanAllocation?.sellingPlan?.id) return null;

  const merchandise = line.merchandise;
  if (!merchandise || merchandise.__typename !== "ProductVariant") return null;
  if (merchandise.id === depositVariantId) return null;

  const isRental = merchandise.product?.isRental === true;
  const hasRentalStart = Boolean(line.rentalStart?.value);
  if (!isRental && !hasRentalStart) return null;

  const unitPrice = Number(line.cost?.amountPerQuantity?.amount);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

  const depositAmount = resolveDepositAmount(
    merchandise.product?.securityDeposit?.jsonValue,
    unitPrice,
    presentmentRate,
  );
  if (!(depositAmount > 0)) return null;

  const currencyCode = line.cost?.amountPerQuantity?.currencyCode || "";
  const depositProperty = formatDepositProperty(depositAmount, currencyCode);

  return {
    cartLineId: line.id,
    expandedCartItems: [
      {
        merchandiseId: merchandise.id,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: moneyString(unitPrice),
            },
          },
        },
        attributes: [{ key: DEPOSIT_PROPERTY_KEY, value: depositProperty }],
      },
      {
        merchandiseId: depositVariantId,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: moneyString(depositAmount),
            },
          },
        },
        attributes: [{ key: "_deposit", value: "true" }],
      },
    ],
  };
}

/**
 * @param {unknown} metafieldJson
 * @param {number} unitPricePresentment
 * @param {number} presentmentRate
 */
function resolveDepositAmount(metafieldJson, unitPricePresentment, presentmentRate) {
  const fromMetafield = parseMoneyAmount(metafieldJson);
  if (fromMetafield != null) {
    if (fromMetafield <= 0) return 0;
    return roundCents(fromMetafield * presentmentRate);
  }
  return Math.round(unitPricePresentment * DEFAULT_DEPOSIT_RATIO);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parseMoneyAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && "amount" in value) {
    const parsed = Number(/** @type {{ amount?: unknown }} */ (value).amount);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function gidFromJson(value) {
  if (typeof value === "string" && value.includes("ProductVariant/")) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = /** @type {{ id?: unknown }} */ (value).id;
    if (typeof id === "string" && id.includes("ProductVariant/")) return id;
  }
  return null;
}

/**
 * @param {number} amount
 */
function roundCents(amount) {
  return Math.round(amount * 100) / 100;
}

/**
 * @param {number} amount
 */
function moneyString(amount) {
  return amount.toFixed(2);
}

/**
 * @param {number} amount
 * @param {string} currencyCode
 */
function formatDepositProperty(amount, currencyCode) {
  const value = moneyString(amount);
  const symbols = {
    USD: "$",
    CAD: "$",
    AUD: "$",
    NZD: "$",
    INR: "₹",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
  };
  const symbol = symbols[currencyCode];
  if (symbol) return `${symbol}${value}`;
  return currencyCode ? `${value} ${currencyCode}` : value;
}
