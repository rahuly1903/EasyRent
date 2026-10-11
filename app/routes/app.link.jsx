import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../services/shop.server";
import { configsForProducts, saveLinkedProducts } from "../services/rental-config.server";
import {
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  defaultRentalSettings,
  formForConfigs,
  normalizeRentalSettings,
  settingsEqual,
} from "../lib/rental-settings";
import { BlockDatesField } from "../components/block-dates-field";
import { Checkbox, ClickButton, NumberField } from "../components/polaris-controls";

const MAX_PRODUCTS = 50;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const url = new URL(request.url);
  const ids = (url.searchParams.get("products") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const rows = ids.length ? await configsForProducts(shop.id, ids) : [];
  const active = rows.filter((row) => row.active);
  const resolved = formForConfigs(active.map((row) => row));
  return {
    products: active.map(presentProduct),
    form: resolved.form,
    differ: resolved.differ,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  try {
    if (intent === "load") {
      const productIds = parseJson(form.get("productIds"), []);
      const rows = await configsForProducts(shop.id, productIds);
      return { ok: true, intent, configs: rows.map(presentProduct) };
    }

    if (intent === "save") {
      const productIds = parseJson(form.get("productIds"), []);
      const settings = normalizeRentalSettings(parseJson(form.get("settings"), {}));
      const saved = await saveLinkedProducts({
        admin,
        shopId: shop.id,
        productIds,
        settings,
      });
      return {
        ok: true,
        intent,
        settings,
        products: saved.map(presentProduct),
      };
    }
  } catch (error) {
    console.error(`[link] ${intent} failed`, error);
    return { ok: false, intent, error: error.message || "Something went wrong" };
  }

  return { ok: false, intent, error: "Unknown action" };
};

export default function LinkPage() {
  const loaded = useLoaderData();
  const shopify = useAppBridge();
  const loadFetcher = useFetcher();
  const saveFetcher = useFetcher();
  const loadedKey = loaded.products.map((product) => product.id).join(",");
  const [routeKey, setRouteKey] = useState(loadedKey);
  const [selected, setSelected] = useState(loaded.products);
  const [form, setForm] = useState(loaded.form);
  const [differ, setDiffer] = useState(loaded.differ);
  const snapshot = useRef({
    products: loaded.products,
    form: loaded.form,
    differ: loaded.differ,
  });
  const appliedLoad = useRef(null);
  const appliedSave = useRef(null);
  const pickerOpen = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  if (routeKey !== loadedKey) {
    setRouteKey(loadedKey);
    setSelected(loaded.products);
    setForm(loaded.form);
    setDiffer(loaded.differ);
    snapshot.current = {
      products: loaded.products,
      form: loaded.form,
      differ: loaded.differ,
    };
  }

  const dirty = isDirty(selected, form, snapshot.current, differ);
  const saving = saveFetcher.state !== "idle";

  useEffect(() => {
    const data = loadFetcher.data;
    if (!data || data === appliedLoad.current || data.intent !== "load" || !data.ok) return;
    appliedLoad.current = data;
    const byId = Object.fromEntries(data.configs.map((row) => [row.id, row]));
    const next = selectedRef.current.map((product) => mergeProduct(product, byId[product.id]));
    const activeSettings = next.filter((product) => product.active).map((product) => product.settings);
    const resolved = formForConfigs(activeSettings);
    setSelected(next);
    setForm(resolved.form);
    setDiffer(resolved.differ);
  }, [loadFetcher.data]);

  useEffect(() => {
    const data = saveFetcher.data;
    if (!data || data === appliedSave.current || data.intent !== "save") return;
    appliedSave.current = data;
    if (!data.ok) return;
    setSelected(data.products);
    setForm(data.settings);
    setDiffer(false);
    snapshot.current = { products: data.products, form: data.settings, differ: false };
    shopify.toast.show("Rental settings saved");
  }, [saveFetcher.data, shopify]);

  function updateForm(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateWeekday(day, key, checked) {
    setForm((current) => ({
      ...current,
      weekdays: {
        ...current.weekdays,
        [day]: { ...current.weekdays[day], [key]: checked },
      },
    }));
  }

  async function openPicker() {
    if (pickerOpen.current) return;
    pickerOpen.current = true;
    try {
      const picked = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: MAX_PRODUCTS,
        filter: { variants: false },
        selectionIds: selectedRef.current.map((product) => ({ id: product.id })),
      });
      if (!picked) return;
      const products = picked.slice(0, MAX_PRODUCTS).map(presentPickedProduct);
      setSelected(products);
      if (!products.length) {
        setForm(defaultRentalSettings());
        setDiffer(false);
        return;
      }
      const body = new FormData();
      body.set("intent", "load");
      body.set("productIds", JSON.stringify(products.map((product) => product.id)));
      loadFetcher.submit(body, { method: "POST" });
    } catch (error) {
      shopify.toast.show(error?.message || "Could not open the product picker", { isError: true });
    } finally {
      pickerOpen.current = false;
    }
  }

  function save() {
    const body = new FormData();
    body.set("intent", "save");
    body.set("productIds", JSON.stringify(selected.map((product) => product.id)));
    body.set("settings", JSON.stringify(form));
    saveFetcher.submit(body, { method: "POST" });
  }

  function discard() {
    setSelected(snapshot.current.products);
    setForm(snapshot.current.form);
    setDiffer(snapshot.current.differ);
  }

  const loadedCopy = linkedSettingsCopy(selected, differ);

  return (
    <s-page heading="Link">
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>
      <SaveBar id="link-products-save" open={dirty}>
        <button variant="primary" disabled={saving} onClick={save}></button>
        <button disabled={saving} onClick={discard}></button>
      </SaveBar>

      <s-stack direction="block" gap="large">
        <s-grid gridTemplateColumns="220px 1fr" gap="large" alignItems="center">
          <s-text type="strong">Select Products</s-text>
          <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="center">
            <ClickButton variant="primary" disabled={saving} onClick={openPicker}>
              Select Products
            </ClickButton>
            {loadedCopy ? (
              <s-box padding="base" borderRadius="base" background="base" borderWidth="base">
                <s-text>{loadedCopy}</s-text>
              </s-box>
            ) : (
              <s-text color="subdued">{countLabel(selected.length)}</s-text>
            )}
          </s-grid>
        </s-grid>

        {saveFetcher.data?.error ? (
          <s-banner tone="critical" heading="Could not save">
            {saveFetcher.data.error}
          </s-banner>
        ) : null}

        {selected.length ? (
          <s-stack direction="block" gap="large">
            {differ ? (
              <s-banner tone="info">
                Selected products have different settings. Saving applies this form to all of them.
              </s-banner>
            ) : null}

            <s-grid gridTemplateColumns="220px 1fr" gap="large" alignItems="start">
              <s-stack direction="block" gap="small-200">
                <s-heading>Block dates</s-heading>
                <s-paragraph color="subdued">Block any dates you want on calendar</s-paragraph>
              </s-stack>
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <BlockDatesField
                  dates={form.blockDates}
                  onChange={(blockDates) => updateForm({ blockDates })}
                />
              </s-box>
            </s-grid>

            <s-grid gridTemplateColumns="220px 1fr" gap="large" alignItems="start">
              <s-heading>Availability</s-heading>
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <NumberField
                    label="Calendar Start"
                    details={offsetCopy(form.calendarStartDays, false)}
                    min={0}
                    step={1}
                    value={String(form.calendarStartDays)}
                    suffix="days"
                    onChange={(event) => updateForm({ calendarStartDays: fieldValue(event) })}
                  ></NumberField>
                  <NumberField
                    label="Calendar End"
                    details={offsetCopy(form.calendarEndDays, true)}
                    min={0}
                    step={1}
                    value={String(form.calendarEndDays)}
                    suffix="days"
                    onChange={(event) => updateForm({ calendarEndDays: fieldValue(event) })}
                  ></NumberField>
                  <s-stack direction="block" gap="small-200">
                    <s-text type="strong">Active Weekdays</s-text>
                    {WEEKDAY_KEYS.map((day) => (
                      <s-grid key={day} gridTemplateColumns="140px 1fr 1fr" gap="base" alignItems="center">
                        <s-text>{WEEKDAY_LABELS[day]}</s-text>
                        <Checkbox
                          label="Start"
                          checked={form.weekdays[day]?.start !== false}
                          onChange={(event) => updateWeekday(day, "start", fieldChecked(event))}
                        ></Checkbox>
                        <Checkbox
                          label="End"
                          checked={form.weekdays[day]?.end !== false}
                          onChange={(event) => updateWeekday(day, "end", fieldChecked(event))}
                        ></Checkbox>
                      </s-grid>
                    ))}
                  </s-stack>
                </s-stack>
              </s-box>
            </s-grid>

            <s-grid gridTemplateColumns="220px 1fr" gap="large" alignItems="start">
              <s-stack direction="block" gap="small-200">
                <s-heading>Deposit</s-heading>
                <s-paragraph color="subdued">
                  Deposit product will be charged at same time as order. You will be able to refund it manually via
                  partial refund of shopify.
                </s-paragraph>
              </s-stack>
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <NumberField
                    label="Deposit Amount"
                    min={0}
                    step={1}
                    value={String(form.depositAmount)}
                    onChange={(event) => updateForm({ depositAmount: fieldValue(event) })}
                  ></NumberField>
                  <NumberField
                    label="Deposit %"
                    min={0}
                    max={100}
                    step={1}
                    value={String(form.depositPercent)}
                    onChange={(event) => updateForm({ depositPercent: fieldValue(event) })}
                  ></NumberField>
                </s-stack>
              </s-box>
            </s-grid>
          </s-stack>
        ) : null}
      </s-stack>
    </s-page>
  );
}

function presentPickedProduct(product) {
  const image = product.images?.[0];
  return {
    id: product.id,
    title: product.title || "Untitled product",
    handle: product.handle || "",
    image: image?.originalSrc || image?.url || "",
    active: false,
    settings: null,
  };
}

function presentProduct(row) {
  return {
    id: row.productId,
    title: row.productTitle || "Untitled product",
    handle: row.productHandle || "",
    image: row.productImage || "",
    active: Boolean(row.active),
    settings: normalizeRentalSettings(row),
  };
}

function mergeProduct(product, config) {
  if (!config) return { ...product, active: false, settings: null };
  return {
    ...product,
    title: config.title || product.title,
    handle: config.handle || product.handle,
    image: config.image || product.image,
    active: config.active,
    settings: config.settings,
  };
}

function isDirty(selected, form, snapshot, differ) {
  if (!selected.length) return false;
  if (differ) return true;
  if (selected.some((product) => !product.active)) return true;
  const ids = selected.map((product) => product.id).sort().join(",");
  const saved = snapshot.products.map((product) => product.id).sort().join(",");
  if (ids !== saved) return true;
  return !settingsEqual(form, snapshot.form);
}

function linkedSettingsCopy(products, differ) {
  if (differ || !products.length || !products.every((product) => product.active)) return "";
  if (products.length === 1) return `${products[0].title} - Rent settings loaded`;
  return `${products.length} products - Rent settings loaded`;
}

function countLabel(count) {
  return count === 1 ? "1 product selected" : `${count} products selected`;
}

function offsetCopy(days, end) {
  const offset = Number(days) || 0;
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const formatted = date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  const verb = end ? "end" : "start";
  return `Calendar will ${verb} +${offset} days from today's date (E.g.: today it will ${verb} at ${formatted})`;
}

function fieldValue(event) {
  const target = event.currentTarget || event.target;
  return target?.value ?? "";
}

function fieldChecked(event) {
  const target = event.currentTarget || event.target;
  return Boolean(target?.checked);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
