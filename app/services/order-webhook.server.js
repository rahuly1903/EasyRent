const ORDER_QUERY = `#graphql
  query OrderForBooking($id: ID!) {
    order(id: $id) {
      id
      name
      email
      customer {
        id
        defaultEmailAddress {
          emailAddress
        }
      }
      lineItems(first: 50) {
        nodes {
          id
          title
          variantTitle
          customAttributes {
            key
            value
          }
          product {
            id
          }
          variant {
            id
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
  }
`;

export function orderGidFromPayload(payload) {
  if (!payload) return null;
  const graphqlId = payload.admin_graphql_api_id || payload.adminGraphqlApiId;
  if (typeof graphqlId === "string" && graphqlId.includes("/Order/")) return graphqlId;
  if (typeof payload.id === "string" && payload.id.includes("/Order/")) return payload.id;
  if (payload.order_id != null) return toGid("Order", payload.order_id);
  if (payload.id != null && isNumericId(payload.id)) return toGid("Order", payload.id);
  return null;
}

export async function fetchOrderForBooking(admin, orderId) {
  const res = await admin.graphql(ORDER_QUERY, { variables: { id: orderId } });
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  return normalizeGraphqlOrder(body.data?.order);
}

export function normalizeRestOrder(payload) {
  if (!payload) return null;
  const orderId = orderGidFromPayload(payload);
  if (!orderId) return null;
  const items = payload.line_items || payload.lineItems?.nodes || [];
  return {
    orderId,
    orderName: payload.name || null,
    customerId: customerGidFromPayload(payload.customer),
    customerEmail: payload.email || payload.customer?.email || payload.contact_email || null,
    lineItems: items.map(normalizeRestLineItem),
  };
}

export function normalizeGraphqlOrder(order) {
  if (!order?.id) return null;
  return {
    orderId: order.id,
    orderName: order.name || null,
    customerId: order.customer?.id || null,
    customerEmail: order.email || order.customer?.defaultEmailAddress?.emailAddress || null,
    lineItems: (order.lineItems?.nodes || []).map((li) => ({
      id: li.id || null,
      title: li.title || null,
      productId: li.product?.id || null,
      variantId: li.variant?.id || null,
      variantTitle: li.variantTitle || li.title || null,
      properties: li.customAttributes || [],
      selectedOptions: li.variant?.selectedOptions || [],
    })),
  };
}

export function mergeOrderSources(gqlOrder, restOrder) {
  if (!gqlOrder && !restOrder) return null;
  if (!gqlOrder) return restOrder;
  if (!restOrder) return gqlOrder;
  return {
    orderId: gqlOrder.orderId || restOrder.orderId,
    orderName: gqlOrder.orderName || restOrder.orderName,
    customerId: gqlOrder.customerId || restOrder.customerId,
    customerEmail: gqlOrder.customerEmail || restOrder.customerEmail,
    lineItems: mergeLineItems(gqlOrder.lineItems, restOrder.lineItems),
  };
}

function mergeLineItems(gqlItems, restItems) {
  if (!gqlItems?.length) return restItems || [];
  if (!restItems?.length) return gqlItems;
  return gqlItems.map((item, index) => {
    if (hasNamedAttributes(item.properties)) return item;
    const rest =
      restItems.find((candidate) => idsMatch(candidate.id, item.id)) || restItems[index];
    if (!rest || !hasNamedAttributes(rest.properties)) return item;
    return {
      ...item,
      productId: item.productId || rest.productId,
      variantId: item.variantId || rest.variantId,
      variantTitle: item.variantTitle || rest.variantTitle,
      properties: rest.properties,
      selectedOptions: item.selectedOptions?.length ? item.selectedOptions : rest.selectedOptions,
    };
  });
}

function normalizeRestLineItem(li) {
  return {
    id: li.admin_graphql_api_id || toGid("LineItem", li.id),
    title: li.title || null,
    productId: li.product?.id || toGid("Product", li.product_id),
    variantId: li.variant?.id || toGid("ProductVariant", li.variant_id),
    variantTitle: li.variant_title || li.variantTitle || li.title || null,
    properties: li.properties || li.customAttributes || [],
    selectedOptions: li.variant?.selectedOptions || [],
  };
}

function customerGidFromPayload(customer) {
  if (!customer) return null;
  if (customer.admin_graphql_api_id) return customer.admin_graphql_api_id;
  if (typeof customer.id === "string" && customer.id.startsWith("gid://")) return customer.id;
  if (customer.id != null) return toGid("Customer", customer.id);
  return null;
}

function hasNamedAttributes(properties) {
  if (!properties) return false;
  if (Array.isArray(properties)) {
    return properties.some((p) => p && (p.name || p.key));
  }
  return typeof properties === "object" && Object.keys(properties).length > 0;
}

function idsMatch(a, b) {
  return Boolean(a && b && idTail(a) === idTail(b));
}

function idTail(id) {
  const value = String(id);
  const match = /\/(\d+)\s*$/.exec(value);
  return match ? match[1] : value;
}

function toGid(type, id) {
  if (id == null || id === "") return null;
  const value = String(id);
  if (value.startsWith("gid://")) return value;
  return `gid://shopify/${type}/${value}`;
}

function isNumericId(id) {
  return typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id));
}
