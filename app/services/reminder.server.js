import prisma from "../db.server";
import { addDaysUtc, todayUtc } from "../lib/dates";

// Pluggable channel interface. Add WhatsApp (Interakt/Gupshup) later by
// exporting another sender with the same shape.
async function sendEmail({ to, subject, text, from }) {
  if (!to) return { sent: false, reason: "no-recipient" };
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[reminder:mock-email]", { to, subject, text });
    return { sent: true, mock: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: from || process.env.RESEND_FROM || "noreply@example.com",
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
  return { sent: true };
}

const CHANNELS = {
  email: sendEmail,
};

export async function dispatch(channel, payload) {
  const fn = CHANNELS[channel] || CHANNELS.email;
  return fn(payload);
}

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

export async function runReminders() {
  const shops = await prisma.shop.findMany({
    where: { active: true },
    include: { settings: true },
  });
  const today = todayUtc();
  let deliveryCount = 0;
  let pickupCount = 0;

  for (const shop of shops) {
    const settings = shop.settings || (await prisma.settings.findUnique({ where: { shopId: shop.id } }));
    if (!settings) continue;
    const leadDays = settings.reminderDaysBefore ?? 2;
    const target = addDaysUtc(today, leadDays);
    const nextDay = addDaysUtc(target, 1);
    const targetEnd = target; // pickup reminder uses same offset
    const targetEndNext = nextDay;

    const [dueDeliveries, duePickups] = await Promise.all([
      prisma.booking.findMany({
        where: {
          shopId: shop.id,
          status: { in: ["pending", "confirmed"] },
          reminderDeliverySent: false,
          startDate: { gte: target, lt: nextDay },
        },
        include: { rentalUnit: true },
      }),
      prisma.booking.findMany({
        where: {
          shopId: shop.id,
          status: { in: ["confirmed", "out"] },
          reminderPickupSent: false,
          endDate: { gte: targetEnd, lt: targetEndNext },
        },
        include: { rentalUnit: true },
      }),
    ]);

    for (const b of dueDeliveries) {
      await dispatch(settings.reminderChannelCustomer, {
        to: b.customerEmail,
        subject: `Your rental starts on ${fmt(b.startDate)}`,
        text: `Reminder: your rental (${b.rentalUnit.productTitle || b.rentalUnit.productId}) starts ${fmt(b.startDate)} and ends ${fmt(b.endDate)}. Order ${b.orderName || b.orderId || ""}.`,
        from: settings.fromEmail,
      });
      await dispatch(settings.reminderChannelMerchant, {
        to: settings.merchantEmail,
        subject: `Rental delivery due ${fmt(b.startDate)} — ${b.rentalUnit.productTitle || ""}`,
        text: `Booking ${b.id} delivery ${fmt(b.startDate)} for ${b.customerEmail || "customer"}.`,
        from: settings.fromEmail,
      });
      await prisma.booking.update({
        where: { id: b.id },
        data: { reminderDeliverySent: true },
      });
      deliveryCount++;
    }

    for (const b of duePickups) {
      await dispatch(settings.reminderChannelCustomer, {
        to: b.customerEmail,
        subject: `Your rental ends on ${fmt(b.endDate)}`,
        text: `Reminder: please return your rental (${b.rentalUnit.productTitle || b.rentalUnit.productId}) by ${fmt(b.endDate)}.`,
        from: settings.fromEmail,
      });
      await dispatch(settings.reminderChannelMerchant, {
        to: settings.merchantEmail,
        subject: `Rental pickup due ${fmt(b.endDate)} — ${b.rentalUnit.productTitle || ""}`,
        text: `Booking ${b.id} pickup ${fmt(b.endDate)} from ${b.customerEmail || "customer"}.`,
        from: settings.fromEmail,
      });
      await prisma.booking.update({
        where: { id: b.id },
        data: { reminderPickupSent: true },
      });
      pickupCount++;
    }
  }
  return { deliveries: deliveryCount, pickups: pickupCount };
}
