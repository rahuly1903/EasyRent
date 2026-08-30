import { useEffect } from "react";
import { useLoaderData, useFetcher, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOrCreateShop, getSettings, updateSettings } from "../services/shop.server";
import { SubmitButton } from "../components/SubmitButton";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const settings = await getSettings(shop.id);
  return { settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const form = await request.formData();
  const data = {
    defaultBufferBefore: Math.max(0, Number(form.get("defaultBufferBefore") || 0)),
    defaultBufferAfter: Math.max(0, Number(form.get("defaultBufferAfter") || 0)),
    reminderDaysBefore: Math.max(0, Number(form.get("reminderDaysBefore") || 0)),
    reminderChannelCustomer: String(form.get("reminderChannelCustomer") || "email"),
    reminderChannelMerchant: String(form.get("reminderChannelMerchant") || "email"),
    fromEmail: (form.get("fromEmail") || "").toString().trim() || null,
    merchantEmail: (form.get("merchantEmail") || "").toString().trim() || null,
  };
  await updateSettings(shop.id, data);
  return { ok: true };
};

const CHANNEL_OPTIONS = JSON.stringify([
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp (coming soon)" },
]);

export default function SettingsPage() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  return (
    <s-page heading="Rental settings">
      <fetcher.Form method="POST">
        <s-block gap="base">
          <s-section heading="Buffers (defaults)">
            <s-paragraph>
              These buffers apply to all rental products. Rentable quantity is set on each
              product variant in Shopify (Rentable quantity metafield). Leave that field empty
              to default to 1. Security deposit is a product metafield (Rental security deposit);
              leave it empty to charge 70% of the rental price, rounded.
            </s-paragraph>
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-number-field
                name="defaultBufferBefore"
                label="Buffer days before"
                value={String(settings.defaultBufferBefore)}
                min={0}
                step={1}
              ></s-number-field>
              <s-number-field
                name="defaultBufferAfter"
                label="Buffer days after"
                value={String(settings.defaultBufferAfter)}
                min={0}
                step={1}
              ></s-number-field>
            </s-grid>
          </s-section>
          <s-section heading="Reminders">
            <s-stack direction="block" gap="base">
              <s-number-field
                name="reminderDaysBefore"
                label="Days before start/end"
                value={String(settings.reminderDaysBefore)}
                min={0}
                step={1}
              ></s-number-field>
              <s-select
                name="reminderChannelCustomer"
                label="Customer channel"
                value={settings.reminderChannelCustomer}
                options={CHANNEL_OPTIONS}
              ></s-select>
              <s-select
                name="reminderChannelMerchant"
                label="Merchant channel"
                value={settings.reminderChannelMerchant}
                options={CHANNEL_OPTIONS}
              ></s-select>
              <s-email-field name="fromEmail" label="From email" value={settings.fromEmail ?? ""}></s-email-field>
              <s-email-field name="merchantEmail" label="Merchant email" value={settings.merchantEmail ?? ""}></s-email-field>
            </s-stack>
          </s-section>
          <SubmitButton variant="primary" {...(saving ? { loading: true } : {})}>
            Save
          </SubmitButton>
        </s-block>
      </fetcher.Form>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
