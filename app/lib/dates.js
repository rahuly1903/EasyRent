// UTC-midnight date helpers. All rental dates stored as 00:00:00.000 UTC.

export function toUtcMidnight(input) {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function todayUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDaysUtc(date, days) {
  const d = toUtcMidnight(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function diffDaysUtc(a, b) {
  const ms = toUtcMidnight(a).getTime() - toUtcMidnight(b).getTime();
  return Math.round(ms / 86400000);
}

export function ymd(date) {
  const d = toUtcMidnight(date);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

export function parseYmd(str) {
  if (!str) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
