import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

const stepColumns = "@container (inline-size > 640px) 1fr 1fr, 1fr";

const STEPS = [
  {
    number: "1",
    title: "Tag the products",
    body: "In Shopify, add the Rent tag to every product customers can book. Ready To Ship opens the calendar 2 days from today. Rent on its own, or Rent with Made to order, opens it 15 days out. If both shipping tags are present, 2 days is used.",
  },
  {
    number: "2",
    title: "Link them here",
    body: "Open Link products, or import a CSV from the dashboard. Set the bookable window, blocked dates, which weekdays a rental can start or end, and the deposit. The date picker appears only on linked products.",
  },
  {
    number: "3",
    title: "Add the storefront block",
    body: "In the theme editor, add the Rental picker block to the product template. Choose a security deposit product that is published to the Online Store. Price its variants in steps of 10. The block adds the variant whose price matches the deposit.",
  },
  {
    number: "4",
    title: "Watch the bookings",
    body: "A checkout creates a pending booking. Payment confirms it. Cancelling or refunding the order releases the dates. Use Bookings for today’s deliveries, pickups, and late returns.",
  },
];

export default function GuidePage() {
  return (
    <s-page heading="Guide" inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>
      <s-stack direction="block" gap="large">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Rent Now turns selected products into date-based rentals. Link a product, customers
              pick a start date on the product page, and the order shows up here as a booking.
            </s-paragraph>
            <s-query-container>
              <s-grid gridTemplateColumns={stepColumns} gap="base">
                {STEPS.map((step) => (
                  <s-box
                    key={step.number}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-stack direction="block" gap="small-200">
                      <s-badge tone="info">{step.number}</s-badge>
                      <s-heading>{step.title}</s-heading>
                      <s-paragraph color="subdued">{step.body}</s-paragraph>
                    </s-stack>
                  </s-box>
                ))}
              </s-grid>
            </s-query-container>
          </s-stack>
        </s-section>

        <s-section heading="Dashboard">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Home for the shop. The top cards count orders and products booked in the last 30
              days, and bookings whose dates fall in the current month.
            </s-paragraph>
            <s-unordered-list>
              <s-list-item>
                Search linked products, and sort them by newest, oldest, or name.
              </s-list-item>
              <s-list-item>
                Each row shows the calendar window, duration options, stock, and deposit. Stock is
                the Rentable quantity on each variant added together. An empty quantity counts as 1.
              </s-list-item>
              <s-list-item>
                Edit one product, open it on the online store, or unlink it. Unlinking removes it
                from the picker.
              </s-list-item>
              <s-list-item>
                Select up to 50 products to edit them together, or unlink the selection.
              </s-list-item>
              <s-list-item>
                Export downloads a CSV with product title and handle. Import reads that same file,
                finds each handle in Shopify, and links products that have the Rent tag.
              </s-list-item>
            </s-unordered-list>
            <s-button href="/app" variant="secondary">
              Open Dashboard
            </s-button>
          </s-stack>
        </s-section>

        <s-section heading="Link products">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Choose up to 50 products and save one set of rental rules for all of them. If the
              selected products already differ, saving replaces each of them with the form you see.
            </s-paragraph>
            <s-unordered-list>
              <s-list-item>
                Block dates keeps specific days off the calendar, such as holidays or blackout
                periods.
              </s-list-item>
              <s-list-item>
                Calendar start and calendar end are day counts from today. The default window is 15
                days from today through 365 days from today.
              </s-list-item>
              <s-list-item>
                Active weekdays decide which days a rental may start and which days it may end.
                Uncheck a day to close it.
              </s-list-item>
              <s-list-item>
                Deposit amount is a fixed refundable charge. Leave it at 0 to charge the deposit
                percent of the variant price instead. The default percent is 70, and the storefront
                rounds the result to the nearest 10.
              </s-list-item>
              <s-list-item>
                The deposit is added as its own product at checkout. Refund it from the Shopify
                order when the item is returned.
              </s-list-item>
            </s-unordered-list>
            <s-paragraph color="subdued">
              Duration comes from the product, not this form. Add an option named Rent for or
              Duration, with values such as 3 days or 7 days. The customer picks a start date, and
              the end date follows that length.
            </s-paragraph>
            <s-button href="/app/link" variant="secondary">
              Open Link products
            </s-button>
          </s-stack>
        </s-section>

        <s-section heading="Bookings">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Every rental order is listed with its product, dates, customer, and status. Pending
              means the order is not paid yet. Confirmed means it is paid. Cancelled means the
              order was cancelled or refunded.
            </s-paragraph>
            <s-unordered-list>
              <s-list-item>All shows every booking, including how many days a return is late.</s-list-item>
              <s-list-item>
                Upcoming booking covers pending or confirmed rentals that start within the next 14
                days, not including today.
              </s-list-item>
              <s-list-item>
                Today’s deliveries are pending or confirmed rentals that start today.
              </s-list-item>
              <s-list-item>Today’s pickups are confirmed rentals that end today.</s-list-item>
              <s-list-item>
                Overdue returns are confirmed rentals whose end date has already passed.
              </s-list-item>
              <s-list-item>
                Edit buffer adds extra blocked days before delivery and after return for that
                booking only, so the item can be prepared and checked back in.
              </s-list-item>
            </s-unordered-list>
            <s-button href="/app/bookings" variant="secondary">
              Open Bookings
            </s-button>
          </s-stack>
        </s-section>

        <s-section heading="Settings">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Open Settings from the dashboard. These values are the shop defaults. Product rules on
              Link products still control the calendar, deposit, and blocked dates.
            </s-paragraph>
            <s-unordered-list>
              <s-list-item>
                Buffer days before and buffer days after are the default extra days blocked around
                a rental. A booking can override them from Bookings.
              </s-list-item>
              <s-list-item>
                Days before start/end sets how early reminder emails go out, to the customer and to
                the merchant address. WhatsApp is listed for later and is not sent yet.
              </s-list-item>
              <s-list-item>
                From email is the sender. Merchant email is where your copy of the reminder goes.
              </s-list-item>
            </s-unordered-list>
            <s-button href="/app/settings" variant="secondary">
              Open Settings
            </s-button>
          </s-stack>
        </s-section>

        <s-section heading="Product page">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              The Rental picker block replaces the normal add-to-cart button on linked products. It
              stays hidden on products that are not linked.
            </s-paragraph>
            <s-unordered-list>
              <s-list-item>
                The customer chooses a start date. Unavailable days are dates outside the window,
                blocked dates, closed weekdays, and dates that are already fully booked.
              </s-list-item>
              <s-list-item>
                The block shows the rental length, the end date, and the refundable deposit before
                the customer adds the item.
              </s-list-item>
              <s-list-item>
                The cart line stores Rental Start, Rental End, Duration, Rental Dates, and the
                refundable security deposit.
              </s-list-item>
              <s-list-item>
                In the block settings, keep the app proxy base at /apps/rental unless that path was
                changed, hide the theme add-to-cart button, and select the security deposit product.
              </s-list-item>
            </s-unordered-list>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
