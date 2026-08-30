import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateShop } from "../services/shop.server";
import { dashboardBuckets } from "../services/booking.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const [unitCount, bookingCount, buckets] = await Promise.all([
    prisma.rentalUnit.count({ where: { shopId: shop.id, active: true } }),
    prisma.booking.count({ where: { shopId: shop.id, status: { not: "cancelled" } } }),
    dashboardBuckets(shop.id),
  ]);
  return {
    shop: shop.shopDomain,
    unitCount,
    bookingCount,
    today: buckets.deliveries.length + buckets.pickups.length,
  };
};

export default function Index() {
  const { unitCount, bookingCount, today } = useLoaderData();
 
  return (
    <s-page heading="EasyRent">
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>Active rental units</s-text>
              <s-heading>{String(unitCount)}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>Open bookings</s-text>
              <s-heading>{String(bookingCount)}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>Today's deliveries + pickups</s-text>
              <s-heading>{String(today)}</s-heading>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>
      <s-section heading="Get started">
        <s-unordered-list>
          <s-list-item>
            Tag rental products with <s-text type="strong">rental</s-text>, or add them to a
            collection with handle <s-text type="strong">rentals</s-text>
          </s-list-item>
          <s-list-item>
            Set <s-text type="strong">Rentable quantity</s-text> on each variant in Shopify.
            Leave it empty to default to 1
          </s-list-item>
          <s-list-item>
            Add the <s-text type="strong">Rental picker</s-text> app block to your product page
          </s-list-item>
          <s-list-item>
            Track orders on <s-link href="/app/bookings">Bookings</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
