import prisma from "../db.server";

export async function getOrCreateShop(shopDomain) {
  const existing = await prisma.shop.findUnique({
    where: { shopDomain },
    include: { settings: true },
  });
  if (existing) {
    if (!existing.settings) {
      const settings = await prisma.settings.create({ data: { shopId: existing.id } });
      existing.settings = settings;
    }
    if (!existing.active) {
      await prisma.shop.update({ where: { id: existing.id }, data: { active: true } });
    }
    return existing;
  }
  const shop = await prisma.shop.create({
    data: { shopDomain, settings: { create: {} } },
    include: { settings: true },
  });
  return shop;
}

export async function getSettings(shopId) {
  const s = await prisma.settings.findUnique({ where: { shopId } });
  if (s) return s;
  return prisma.settings.create({ data: { shopId } });
}

export async function updateSettings(shopId, data) {
  await getSettings(shopId);
  return prisma.settings.update({ where: { shopId }, data });
}

export async function deactivateShop(shopDomain) {
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return null;
  await prisma.shop.update({ where: { id: shop.id }, data: { active: false } });
  await prisma.rentalUnit.updateMany({ where: { shopId: shop.id }, data: { active: false } });
  return shop;
}
