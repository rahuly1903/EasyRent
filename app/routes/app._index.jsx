import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigation, useRouteError, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../services/shop.server";
import {
  dashboardStats,
  deactivateUnlinkedUnits,
  linkRentTaggedProducts,
  listLinkedProducts,
  unlinkProducts,
} from "../services/rental-config.server";
import { Checkbox, ClickButton, SearchField } from "../components/polaris-controls";

const EDIT_PRODUCT_LIMIT = 50;
const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "title", label: "A-Z" },
];

const PAGE_SIZE = 20;
const statColumns = "@container (inline-size > 400px) 1fr 1fr, 1fr";
const summaryColumns = "minmax(0, 1fr) auto";
const bulkColumns = "@container (inline-size > 640px) minmax(0, 1fr) auto, minmax(0, 1fr)";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  await deactivateUnlinkedUnits(shop.id).catch((error) => {
    console.error("[app] deactivate unlinked units", error);
  });

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const sort = ["newest", "oldest", "title"].includes(url.searchParams.get("sort"))
    ? url.searchParams.get("sort")
    : "newest";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const [stats, list] = await Promise.all([
    dashboardStats(shop.id),
    listLinkedProducts({ shopId: shop.id, q, sort, page, pageSize: PAGE_SIZE }),
  ]);

  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const themeEditorUrl = apiKey
    ? `https://${shop.shopDomain}/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/rental_picker&target=newAppsSection`
    : `https://${shop.shopDomain}/admin/themes/current/editor?template=product`;

  return {
    stats,
    q,
    sort,
    page: list.page,
    pageSize: list.pageSize,
    total: list.total,
    totalPages: list.totalPages,
    themeEditorUrl,
    rows: list.rows.map((row) => presentRow(row, shop.shopDomain)),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "unlink") {
    const productIds = parseIds(form.get("productIds"));
    await unlinkProducts({ admin, shopId: shop.id, productIds });
    return { ok: true, intent: "unlink" };
  }

  if (intent === "link-rent-tags") {
    try {
      const result = await linkRentTaggedProducts({ admin, shopId: shop.id });
      return { ok: true, intent, ...result };
    } catch (error) {
      console.error("[app] link rent tags", error);
      const message = error instanceof Error ? error.message : "Could not link products";
      return { ok: false, intent, error: message || "Could not link products" };
    }
  }

  return { ok: false };
};

export default function Dashboard() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const location = useLocation();
  const [checked, setChecked] = useState({});
  const [query, setQuery] = useState(data.q || "");
  const appliedLink = useRef(null);
  const linking = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "link-rent-tags";
  const tableLoading = navigation.state === "loading" && navigation.location?.pathname === location.pathname;
  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);
  const checkedIds = Object.keys(checked);
  const pageIds = data.rows.map((row) => row.id);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked[id]);
  const canBulkEdit = checkedIds.length > 0 && checkedIds.length <= EDIT_PRODUCT_LIMIT;
  const editProductsHref = canBulkEdit
    ? `/app/link?products=${checkedIds.map((id) => encodeURIComponent(id)).join(",")}`
    : "";
  const sortLabel = SORT_OPTIONS.find((option) => option.value === data.sort)?.label || "Newest";

  useEffect(() => {
    setQuery(data.q || "");
  }, [data.q]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.intent === "unlink") {
      shopify.toast.show("Products unlinked");
      setChecked({});
    }
  }, [fetcher.state, fetcher.data, shopify]);

  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result || result.intent !== "link-rent-tags") return;
    if (result === appliedLink.current) return;
    appliedLink.current = result;
    if (!result.ok) {
      shopify.toast.show(result.error || "Could not link products", { isError: true });
      return;
    }
    shopify.toast.show(linkAllSummary(result));
  }, [fetcher.state, fetcher.data, shopify]);

  useEffect(() => {
    const handle = setTimeout(() => {
      const current = searchParams.get("q") || "";
      if (query === current) return;
      const params = new URLSearchParams(searchParams);
      if (query) params.set("q", query);
      else params.delete("q");
      params.set("page", "1");
      setSearchParams(params);
    }, 300);
    return () => clearTimeout(handle);
  }, [query, searchParams, setSearchParams]);

  function updateParams(updates) {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    setSearchParams(params);
  }

  function unlink(ids) {
    const body = new FormData();
    body.set("intent", "unlink");
    body.set("productIds", JSON.stringify(ids));
    fetcher.submit(body, { method: "POST" });
  }

  function addAllProducts() {
    const body = new FormData();
    body.set("intent", "link-rent-tags");
    fetcher.submit(body, { method: "POST" });
  }

  function chooseSort(sort) {
    updateParams({ sort, page: "1" });
    document.getElementById("dashboard-product-sort")?.hideOverlay?.();
  }

  function togglePage(nextChecked) {
    setChecked((current) => {
      const next = { ...current };
      for (const row of data.rows) {
        if (nextChecked) next[row.id] = row.title;
        else delete next[row.id];
      }
      return next;
    });
  }

  function toggleRow(row, nextChecked) {
    setChecked((current) => {
      const next = { ...current };
      if (nextChecked) next[row.id] = row.title;
      else delete next[row.id];
      return next;
    });
  }

  return (
    <s-page heading="Dashboard" inlineSize="large">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small-200" justifyContent="end" alignItems="center" inlineSize="100%">
          <s-button href="/app/settings">Settings</s-button>
          <ClickButton
            loading={linking}
            disabled={fetcher.state !== "idle" ? true : undefined}
            onClick={addAllProducts}
          >
            Add all products
          </ClickButton>
          <s-button variant="primary" href="/app/link">
            Link Products
          </s-button>
        </s-stack>
        <s-query-container>
          <s-grid gridTemplateColumns={statColumns} gap="base">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="base">
                <s-text>Last 30 days</s-text>
                <s-query-container>
                  <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                    <s-stack direction="block" gap="small-200">
                      <s-heading>{String(data.stats.ordersMade)}</s-heading>
                      <s-text color="subdued">Orders made</s-text>
                    </s-stack>
                    <s-stack direction="block" gap="small-200">
                      <s-heading>{String(data.stats.productsBooked)}</s-heading>
                      <s-text color="subdued">Products booked</s-text>
                    </s-stack>
                  </s-grid>
                </s-query-container>
              </s-stack>
            </s-box>
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="small-200">
                <s-text>Bookings this month</s-text>
                <s-heading>{String(data.stats.bookingsThisMonth)}</s-heading>
              </s-stack>
            </s-box>
          </s-grid>
        </s-query-container>

        <s-section padding="none" accessibilityLabel="Linked products">
          {data.rows.length ? (
            <s-table
              loading={tableLoading}
              paginate
              hasPreviousPage={data.page > 1}
              hasNextPage={data.page < data.totalPages}
              onPreviousPage={() => updateParams({ page: String(data.page - 1) })}
              onNextPage={() => updateParams({ page: String(data.page + 1) })}
              paginationLabel={`${from}–${to} of ${data.total}`}
            >
              <ProductToolbar
                slot="filters"
                query={query}
                onQuery={setQuery}
                checked={checked}
                checkedIds={checkedIds}
                onClear={() => setChecked({})}
                canBulkEdit={canBulkEdit}
                editProductsHref={editProductsHref}
                unlinkLoading={fetcher.state !== "idle"}
                onUnlink={() => unlink(checkedIds)}
                total={data.total}
                sortLabel={sortLabel}
              />
              <s-table-header-row>
                <s-table-header listSlot="primary">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <Checkbox
                      accessibilityLabel="Select all products on this page"
                      checked={allChecked}
                      onChange={() => togglePage(!allChecked)}
                    ></Checkbox>
                    <s-text>Product</s-text>
                  </s-stack>
                </s-table-header>
                <s-table-header listSlot="labeled">Rental</s-table-header>
                <s-table-header listSlot="secondary"></s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="base" alignItems="center">
                        <Checkbox
                          accessibilityLabel={`Select ${row.title}`}
                          checked={Boolean(checked[row.id])}
                          onChange={(event) => {
                            const target = event.currentTarget || event.target;
                            toggleRow(row, Boolean(target.checked));
                          }}
                        ></Checkbox>
                        <s-thumbnail src={row.image} alt={row.title} size="small"></s-thumbnail>
                        <s-box minInlineSize="0">
                          <s-text type="strong">{row.title}</s-text>
                        </s-box>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-badge tone="success">{bookingLabel(row.bookingType)}</s-badge>
                        <s-badge tone="success">Stock: {row.stock}</s-badge>
                        <s-badge tone="success">
                          {row.calendarStartDays} → {row.calendarEndDays}
                        </s-badge>
                        {row.durationLabels.length ? (
                          <s-badge tone="success">Duration: {row.durationLabels.join(" / ")}</s-badge>
                        ) : null}
                        <s-badge tone="success">
                          Deposit: {formatAmount(row.depositAmount)} / {row.depositPercent}%
                        </s-badge>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-200" alignItems="end">
                        <s-stack direction="inline" gap="small-200">
                          <s-button
                            icon="edit"
                            variant="tertiary"
                            accessibilityLabel={`Edit ${row.title}`}
                            href={`/app/link?products=${encodeURIComponent(row.id)}`}
                          ></s-button>
                          {row.storeUrl ? (
                            <s-button
                              icon="external"
                              variant="tertiary"
                              accessibilityLabel={`View ${row.title} on the online store`}
                              href={row.storeUrl}
                              target="_blank"
                            ></s-button>
                          ) : null}
                          <ClickButton
                            icon="delete"
                            variant="tertiary"
                            tone="critical"
                            accessibilityLabel={`Unlink ${row.title}`}
                            onClick={() => unlink([row.id])}
                          ></ClickButton>
                        </s-stack>
                        <s-text color="subdued">{timeAgo(row.updatedAt)}</s-text>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <>
              <s-box padding="base">
                <ProductToolbar
                  query={query}
                  onQuery={setQuery}
                  checked={checked}
                  checkedIds={checkedIds}
                  onClear={() => setChecked({})}
                  canBulkEdit={canBulkEdit}
                  editProductsHref={editProductsHref}
                  unlinkLoading={fetcher.state !== "idle"}
                  onUnlink={() => unlink(checkedIds)}
                  total={data.total}
                  sortLabel={sortLabel}
                />
              </s-box>
              <s-box padding="large">
                <s-stack direction="block" gap="base" alignItems="center">
                  <s-heading>{data.q ? "No products match that search" : "No linked products yet"}</s-heading>
                  <s-paragraph color="subdued">
                    Link a product to choose how customers book it. The rental picker shows on linked products only.
                  </s-paragraph>
                </s-stack>
              </s-box>
            </>
          )}
        </s-section>
      </s-stack>
      <s-popover id="dashboard-product-sort">
        <s-box padding="base">
          <s-stack direction="block" gap="small-200">
            {SORT_OPTIONS.map((option) => (
              <ClickButton key={option.value} variant="tertiary" onClick={() => chooseSort(option.value)}>
                {option.label}
              </ClickButton>
            ))}
          </s-stack>
        </s-box>
      </s-popover>
    </s-page>
  );
}

/* eslint-disable react/prop-types */
function ProductToolbar({
  slot,
  query,
  onQuery,
  checked,
  checkedIds,
  onClear,
  canBulkEdit,
  editProductsHref,
  unlinkLoading,
  onUnlink,
  total,
  sortLabel,
}) {
  return (
    <s-stack {...(slot ? { slot } : {})} direction="block" gap="base">
      <SearchField
        label="Search products"
        labelAccessibilityVisibility="exclusive"
        placeholder="Search Products"
        value={query}
        onInput={(event) => onQuery(event.currentTarget.value)}
      ></SearchField>
      {checkedIds.length ? (
        <s-query-container>
          <s-grid gridTemplateColumns={bulkColumns} gap="small-200" alignItems="center">
            <s-stack direction="block" gap="small-200">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">{checkedIds.length} selected</s-text>
                <ClickButton variant="tertiary" onClick={onClear}>
                  Clear
                </ClickButton>
              </s-stack>
              <s-text color="subdued">{selectionDetail(checked)}</s-text>
            </s-stack>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-button
                variant="secondary"
                href={canBulkEdit ? editProductsHref : undefined}
                disabled={canBulkEdit ? undefined : true}
                accessibilityLabel={
                  canBulkEdit ? editProductsLabel(checked) : `Select up to ${EDIT_PRODUCT_LIMIT} products to edit`
                }
              >
                Edit products
              </s-button>
              <ClickButton variant="secondary" tone="critical" loading={unlinkLoading} onClick={onUnlink}>
                Unlink products
              </ClickButton>
            </s-stack>
          </s-grid>
        </s-query-container>
      ) : (
        <s-grid gridTemplateColumns={summaryColumns} gap="base" alignItems="center">
          <s-text>{total} Products</s-text>
          <s-button variant="secondary" commandFor="dashboard-product-sort" command="--show" icon="chevron-down">
            Sort by {sortLabel}
          </s-button>
        </s-grid>
      )}
    </s-stack>
  );
}
/* eslint-enable react/prop-types */

function linkAllSummary(result) {
  const total = Number(result.total) || 0;
  if (!total) return "No active products with the Rent tag";
  const ready = Number(result.readyToShip) || 0;
  const fifteen = total - ready;
  const both = Number(result.both) || 0;
  const parts = [`${total} product${total === 1 ? "" : "s"} linked`];
  if (ready) parts.push(`${ready} set to 2 days`);
  if (fifteen) parts.push(`${fifteen} set to 15 days`);
  if (both) parts.push(`${both} had both tags and used 2 days`);
  return `${parts.join(". ")}.`;
}

function selectionDetail(selected) {
  const ids = Object.keys(selected);
  if (ids.length === 1) return `${selected[ids[0]]} — rent settings loaded`;
  return `${ids.length} products — rent settings loaded`;
}

function editProductsLabel(selected) {
  const ids = Object.keys(selected);
  if (ids.length === 1) return `Edit products (${selected[ids[0]]} — rent settings loaded)`;
  return `Edit products (${ids.length} products — rent settings loaded)`;
}

function presentRow(row, shopDomain) {
  const labels = Array.isArray(row.durationLabels) ? row.durationLabels.map(String) : [];
  return {
    id: row.productId,
    title: row.productTitle || "Untitled product",
    image: row.productImage || "",
    storeUrl: row.productHandle ? `https://${shopDomain}/products/${row.productHandle}` : "",
    bookingType: row.bookingType || "single",
    stock: row.stock ?? 1,
    calendarStartDays: row.calendarStartDays,
    calendarEndDays: row.calendarEndDays,
    durationLabels: labels,
    depositAmount: row.depositAmount ?? 0,
    depositPercent: row.depositPercent ?? 70,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function bookingLabel(type) {
  if (type === "range") return "Range";
  if (type === "multiple") return "Multiple";
  return "Single";
}

function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function parseIds(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
