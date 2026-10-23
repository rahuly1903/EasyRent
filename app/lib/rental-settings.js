export const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const WEEKDAY_LABELS = {
  sunday: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};

export function defaultWeekdays() {
  return Object.fromEntries(WEEKDAY_KEYS.map((key) => [key, { start: true, end: true }]));
}

export function defaultRentalSettings() {
  return {
    bookingType: "single",
    blockDates: [],
    calendarStartDays: 15,
    calendarEndDays: 365,
    weekdays: defaultWeekdays(),
    depositAmount: 0,
    depositPercent: 70,
  };
}

export function normalizeRentalSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const calendarStartDays = clampInt(source.calendarStartDays, 0, 3650, 15);
  let calendarEndDays = clampInt(source.calendarEndDays, 0, 3650, 365);
  if (calendarEndDays < calendarStartDays) calendarEndDays = calendarStartDays;
  const depositAmount = clampNumber(source.depositAmount, 0, 100000000, 0);
  const depositPercent = clampInt(source.depositPercent, 0, 100, 70);
  return {
    bookingType: "single",
    blockDates: normalizeDates(source.blockDates),
    calendarStartDays,
    calendarEndDays,
    weekdays: normalizeWeekdays(source.weekdays),
    depositAmount,
    depositPercent,
  };
}

export function settingsEqual(a, b) {
  return JSON.stringify(normalizeRentalSettings(a)) === JSON.stringify(normalizeRentalSettings(b));
}

export function formForConfigs(configs) {
  const settings = (configs || []).map((row) => normalizeRentalSettings(row));
  if (!settings.length) {
    return { form: defaultRentalSettings(), differ: false };
  }
  const first = JSON.stringify(settings[0]);
  const differ = settings.some((item) => JSON.stringify(item) !== first);
  if (differ) return { form: defaultRentalSettings(), differ: true };
  return { form: settings[0], differ: false };
}

export function metafieldPayload(settings) {
  const normalized = normalizeRentalSettings(settings);
  return {
    bookingType: normalized.bookingType,
    blockDates: normalized.blockDates,
    calendarStartDays: normalized.calendarStartDays,
    calendarEndDays: normalized.calendarEndDays,
    weekdays: normalized.weekdays,
    depositAmount: normalized.depositAmount,
    depositPercent: normalized.depositPercent,
  };
}

// Rent is required. Ready To Ship sets Calendar Start to 2 days and wins when
// Made to order is also present. Rent alone, or Rent + Made to order, uses 15.
export function rentalLinkFromTags(tags) {
  const names = new Set(
    (Array.isArray(tags) ? tags : [])
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (!names.has("rent")) return null;
  const readyToShip = names.has("ready to ship");
  const madeToOrder = names.has("made to order");
  return {
    calendarStartDays: readyToShip ? 2 : 15,
    readyToShip,
    madeToOrder,
    both: readyToShip && madeToOrder,
    rentOnly: !readyToShip && !madeToOrder,
  };
}

function normalizeWeekdays(value) {
  const source = value && typeof value === "object" ? value : {};
  const weekdays = {};
  for (const key of WEEKDAY_KEYS) {
    const day = source[key] || {};
    weekdays[key] = {
      start: day.start !== false,
      end: day.end !== false,
    };
  }
  return weekdays;
}

export function parseBlockDates(value) {
  return normalizeDates(value);
}

export function formatBlockDates(value) {
  return parseBlockDates(value)
    .map((iso) => iso.replace(/-/g, "/"))
    .join(", ");
}

function normalizeDates(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const dates = [];
  const seen = new Set();
  for (const item of list) {
    const iso = toIsoDate(item);
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    dates.push(iso);
  }
  dates.sort();
  return dates;
}

function toIsoDate(value) {
  const text = String(value || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso && isRealDate(iso[1], iso[2], iso[3])) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (!slash || !isRealDate(slash[1], slash[2], slash[3])) return null;
  return `${slash[1]}-${pad2(slash[2])}-${pad2(slash[3])}`;
}

function isRealDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function pad2(value) {
  return String(Number(value)).padStart(2, "0");
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}
