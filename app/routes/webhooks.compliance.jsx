import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { deactivateShop } from "../services/shop.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[webhook ${topic}] ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // Merchant fulfills via export tools; nothing to send back.
      return new Response();
    case "CUSTOMERS_REDACT": {
      const customerId = payload?.customer?.id ? `gid://shopify/Customer/${payload.customer.id}` : null;
      const email = payload?.customer?.email || null;
      const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
      if (!shopRow) return new Response();
      await prisma.booking.updateMany({
        where: {
          shopId: shopRow.id,
          OR: [
            customerId ? { customerId } : { id: "" },
            email ? { customerEmail: email } : { id: "" },
          ],
        },
        data: { customerId: null, customerEmail: null },
      });
      return new Response();
    }
    case "SHOP_REDACT": {
      const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
      if (shopRow) {
        await prisma.booking.deleteMany({ where: { shopId: shopRow.id } });
        await prisma.rentalUnit.deleteMany({ where: { shopId: shopRow.id } });
        await prisma.settings.deleteMany({ where: { shopId: shopRow.id } });
        await prisma.shop.delete({ where: { id: shopRow.id } });
      }
      await deactivateShop(shop);
      return new Response();
    }
    default:
      return new Response();
  }
};
