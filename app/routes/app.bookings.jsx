import { useEffect, useRef } from "react";
import {
  useLoaderData,
  useFetcher,
  useRouteError,
  useSearchParams,
  useNavigation,
  useLocation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../services/shop.server";
import { listBookingsPage, overrideBufferForBooking } from "../services/booking.server";
import { diffDaysUtc, todayUtc, toUtcMidnight } from "../lib/dates";
import { TabsBar } from "../components/TabsBar";

const PAGE_SIZE = 10;

const TABS = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming booking(Up to 14 days)" },
  { value: "deliveries", label: "Today's deliveries" },
  { value: "pickups", label: "Today's pickups" },
  { value: "overdue", label: "Overdue returns" },
];

const EMPTY_COPY = {
  all: "No bookings found",
  upcoming: "No upcoming bookings",
  deliveries: "No deliveries today",
  pickups: "No pickups today",
  overdue: "No overdue returns",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const url = new URL(request.url);
  const tab = TABS.some((t) => t.value === url.searchParams.get("tab"))
    ? url.searchParams.get("tab")
    : "all";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const result = await listBookingsPage({
    shopId: shop.id,
    tab,
    page,
    pageSize: PAGE_SIZE,
  });
  const late = tab === "overdue" || tab === "all";
  return {
    tab,
    rows: result.bookings.map((b) => presentBooking(b, { late })),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = String(form.get("id") || "");
  if (!id) return { ok: false };

  if (intent === "buffer") {
    const before = toNum(form.get("bufferBefore"));
    const after = toNum(form.get("bufferAfter"));
    await overrideBufferForBooking({ bookingId: id, before, after });
    return { ok: true, intent };
  }
  return { ok: false };
};

function toNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function presentBooking(b, { late = false } = {}) {
  const start = toUtcMidnight(b.startDate);
  const end = toUtcMidnight(b.endDate);
  const blockStart = toUtcMidnight(b.blockStart);
  const blockEnd = toUtcMidnight(b.blockEnd);
  const nights = Math.max(1, diffDaysUtc(end, start) + 1);
  const bufferBefore = start && blockStart ? Math.max(0, diffDaysUtc(start, blockStart)) : 0;
  const bufferAfter = end && blockEnd ? Math.max(0, diffDaysUtc(blockEnd, end)) : 0;
  const isLateStatus = ["confirmed", "out"].includes(b.status);
  const daysLate =
    late && isLateStatus && end ? Math.max(0, diffDaysUtc(todayUtc(), end)) : 0;
  const variant = b.rentalUnit?.variantTitle || null;

  return {
    id: b.id,
    orderName: formatOrderName(b.orderName),
    productTitle: b.rentalUnit?.productTitle || b.rentalUnit?.productId || "Untitled product",
    sku: variant,
    customerEmail: b.customerEmail || "",
    startLabel: formatShortDate(start),
    endLabel: formatShortDate(end),
    nights,
    bufferBefore,
    bufferAfter,
    daysLate,
    status: b.status || "pending",
  };
}

function formatOrderName(name) {
  if (!name) return "# —";
  const t = String(name).trim();
  if (t.startsWith("#")) return t.replace(/^#\s*/, "# ");
  return `# ${t}`;
}

function formatShortDate(date) {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function nightsLabel(nights) {
  return nights === 1 ? "1 night" : `${nights} nights`;
}

function lateLabel(daysLate) {
  if (daysLate <= 0) return "";
  return daysLate === 1 ? "1 day late" : `${daysLate} days late`;
}

function statusLabel(status) {
  switch (status) {
    case "pending":
      return "Pending";
    case "confirmed":
      return "Confirmed";
    case "out":
      return "Out";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function statusTone(status) {
  switch (status) {
    case "confirmed":
      return "success";
    case "out":
      return "info";
    case "cancelled":
      return "warning";
    default:
      return undefined;
  }
}

export default function BookingsPage() {
  const data = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const location = useLocation();
  const tableLoading =
    navigation.state === "loading" &&
    navigation.location?.pathname === location.pathname;

  function updateParams(updates) {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    setSearchParams(params);
  }

  const showTable = data.rows.length > 0;
  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);

  return (
    <s-page heading="Bookings">
      <s-stack direction="block" gap="base">
        <s-section padding="none">
          <TabsBar
            tabs={TABS}
            activeTab={data.tab}
            onTabChange={(value) => updateParams({ tab: value, page: "1" })}
          />
          <s-box overflow="hidden">
            {showTable ? (
              <>
                <s-table
                  loading={tableLoading}
                  paginate
                  hasPreviousPage={data.totalPages > 1 && data.page > 1}
                  hasNextPage={data.totalPages > 1 && data.page < data.totalPages}
                  onNextPage={() => updateParams({ page: String(data.page + 1) })}
                  onPreviousPage={() => updateParams({ page: String(data.page - 1) })}
                  paginationLabel={`${from}–${to} of ${data.total}`}
                >
                  <s-table-header-row>
                    <s-table-header>Order</s-table-header>
                    <s-table-header>Product</s-table-header>
                    <s-table-header>Dates</s-table-header>
                    <s-table-header>Customer</s-table-header>
                    <s-table-header>Status</s-table-header>
                    <s-table-header></s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {data.rows.map((b) => (
                      <BookingRow key={b.id} b={b} />
                    ))}
                  </s-table-body>
                </s-table>
                {data.rows.map((b) => (
                  <BookingBufferModal key={`buffer-modal-${b.id}`} b={b} />
                ))}
              </>
            ) : (
              <s-box padding="large" background="subdued">
                <s-stack padding="large" direction="inline" justifyContent="center">
                  <s-heading>{EMPTY_COPY[data.tab] || "No bookings found"}</s-heading>
                </s-stack>
              </s-box>
            )}
          </s-box>
        </s-section>
      </s-stack>
    </s-page>
  );
}

function BookingRow({ b }) {
  const modalId = `buffer-modal-${b.id}`;
  const hasBuffer = b.bufferBefore > 0 || b.bufferAfter > 0;
  const late = lateLabel(b.daysLate);

  return (
    <s-table-row>
      <s-table-cell>
        <s-heading>{b.orderName}</s-heading>
      </s-table-cell>
      <s-table-cell>
        <s-box inlineSize="260px" maxInlineSize="260px" overflow="hidden">
          <s-stack direction="block" gap="small-200">
            <s-text type="strong">{b.productTitle}</s-text>
            {b.sku ? <s-text color="subdued">{b.sku}</s-text> : null}
            {hasBuffer ? (
              <s-badge icon="chart-vertical">
                Buffer {b.bufferBefore}d / {b.bufferAfter}d
              </s-badge>
            ) : null}
          </s-stack>
        </s-box>
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="block" gap="small-200">
          <s-text>
            {b.startLabel} → {b.endLabel}
          </s-text>
          {late ? (
            <s-text type="strong" tone="critical">
              {late}
            </s-text>
          ) : (
            <s-text color="subdued">{nightsLabel(b.nights)}</s-text>
          )}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        {b.customerEmail ? (
          <s-link href={`mailto:${b.customerEmail}`}>{b.customerEmail}</s-link>
        ) : (
          <s-text color="subdued">—</s-text>
        )}
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={statusTone(b.status)}>{statusLabel(b.status)}</s-badge>
      </s-table-cell>
      <s-table-cell>
        <s-button commandFor={modalId} command="--show" variant="secondary" icon="plus">
          Edit buffer
        </s-button>
      </s-table-cell>
    </s-table-row>
  );
}

function BookingBufferModal({ b }) {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";
  const modalId = `buffer-modal-${b.id}`;
  const formId = `buffer-form-${b.id}`;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok) return;
    shopify.toast.show("Buffer updated");
    document.getElementById(modalId)?.hideOverlay?.();
  }, [fetcher.state, fetcher.data, shopify, modalId]);

  return (
    <s-modal id={modalId} heading={`Edit buffer · ${b.orderName}`}>
      <fetcher.Form method="POST" id={formId}>
        <input type="hidden" name="intent" value="buffer" />
        <input type="hidden" name="id" value={b.id} />
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            Extra days blocked before delivery and after return for {b.productTitle}.
          </s-paragraph>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-number-field
              name="bufferBefore"
              label="Buffer before"
              value={String(b.bufferBefore)}
              min={0}
              step={1}
            ></s-number-field>
            <s-number-field
              name="bufferAfter"
              label="Buffer after"
              value={String(b.bufferAfter)}
              min={0}
              step={1}
            ></s-number-field>
          </s-grid>
        </s-stack>
      </fetcher.Form>
      <s-button slot="secondary-actions" commandFor={modalId} command="--hide">
        Cancel
      </s-button>
      <BufferSaveButton formId={formId} saving={saving} />
    </s-modal>
  );
}

function BufferSaveButton({ formId, saving }) {
  const ref = useRef(null);

  useEffect(() => {
    const btn = ref.current;
    if (!btn) return;
    const onClick = (event) => {
      event.preventDefault();
      const form = document.getElementById(formId);
      if (form && typeof form.requestSubmit === "function") form.requestSubmit();
    };
    btn.addEventListener("click", onClick);
    return () => btn.removeEventListener("click", onClick);
  }, [formId]);

  return (
    <s-button
      ref={ref}
      slot="primary-action"
      variant="primary"
      type="button"
      {...(saving ? { loading: true } : {})}
    >
      Save
    </s-button>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
