import { runReminders } from "../services/reminder.server";

// Hit daily by an external cron (e.g. cron-job.org). Guard with CRON_SECRET.
export const loader = async ({ request }) => handler(request);
export const action = async ({ request }) => handler(request);

async function handler(request) {
  const url = new URL(request.url);
  const provided =
    url.searchParams.get("token") ||
    (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const expected = process.env.CRON_SECRET;
  if (!expected || provided !== expected) {
    return new Response("unauthorized", { status: 401 });
  }
  const result = await runReminders();
  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { "Content-Type": "application/json" },
  });
}
