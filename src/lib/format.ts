const IST = "Asia/Kolkata";
const IST_OFFSET = "+05:30";
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const dateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const shortDateFormat = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short" });
const longDateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  weekday: "long",
  day: "numeric",
  month: "long",
});
const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const dayMonthFormat = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "long" });
const timeFormat = new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true });
const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", hourCycle: "h23" });
const monthFormat = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date in India as YYYY-MM-DD; every "today", "tomorrow" and day count is measured in IST. */
export function istDateKey(date: Date = new Date()): string {
  return dateKeyFormat.format(date);
}

export function atIst(dateKey: string, hour = 12, minute = 0): Date {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${dateKey}T${hh}:${mm}:00${IST_OFFSET}`);
}

export function endOfIstDay(dateKey: string): Date {
  return new Date(`${dateKey}T23:59:59.999${IST_OFFSET}`);
}

export function istHour(date: Date): number {
  return Number(hourFormat.format(date));
}

/** Billing month in India as YYYY-MM. */
export function monthKey(date: Date = new Date()): string {
  return istDateKey(date).slice(0, 7);
}

export function shiftMonthKey(key: string, months: number): string {
  const [year, month] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return shifted.toISOString().slice(0, 7);
}

function keyToUtc(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function shiftDateKey(dateKey: string, days: number): string {
  return new Date(keyToUtc(dateKey) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetweenKeys(fromKey: string, toKey: string): number {
  return Math.round((keyToUtc(toKey) - keyToUtc(fromKey)) / DAY_MS);
}

export function calendarDaysBetween(from: string | Date, to: string | Date): number {
  return daysBetweenKeys(istDateKey(new Date(from)), istDateKey(new Date(to)));
}

export function hoursSince(from: string | Date, now: Date = new Date()): number {
  return (now.getTime() - new Date(from).getTime()) / HOUR_MS;
}

export function addHours(from: string | Date, hours: number): Date {
  return new Date(new Date(from).getTime() + hours * HOUR_MS);
}

export function weekdayOfKey(dateKey: string): number {
  return new Date(keyToUtc(dateKey)).getUTCDay();
}

export function addBusinessDays(from: Date, businessDays: number): Date {
  let key = istDateKey(from);
  let remaining = businessDays;
  while (remaining > 0) {
    key = shiftDateKey(key, 1);
    const weekday = weekdayOfKey(key);
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return atIst(key, 18);
}

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  return DATE_KEY.test(value) ? atIst(value) : new Date(value);
}

/** "25 Oct" */
export function formatShortDate(value: string | Date): string {
  return shortDateFormat.format(toDate(value));
}

/** "Saturday, 25 October" */
export function formatLongDate(value: string | Date): string {
  return longDateFormat.format(toDate(value));
}

/** "25 October" */
export function formatDayMonth(value: string | Date): string {
  return dayMonthFormat.format(toDate(value));
}

/** "4:12 pm" */
export function formatTime(value: string | Date): string {
  return timeFormat.format(toDate(value));
}

/** "2026-09" → "September 2026" */
export function formatMonth(key: string): string {
  return monthFormat.format(new Date(`${key}-01T00:00:00Z`));
}

/** "25 Oct, 4:12 pm" */
export function formatDateTime(value: string | Date): string {
  return dateTimeFormat.format(toDate(value));
}

/** "₹2,499" with Indian digit grouping. */
export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** "2,499 rupees", which voice engines read more reliably than the ₹ sign. */
export function spokenRupees(amount: number): string {
  return `${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })} rupees`;
}

/** "NB-24117" → "NB 24117", so text-to-speech reads it as a reference rather than a subtraction. */
export function spokenId(id: string): string {
  return id.replace(/[-/]+/g, " ");
}

export function lastDigits(value: string, count = 4): string {
  return value.replace(/\D/g, "").slice(-count);
}

/** E.164; bare Indian numbers (10 digits, 0-prefixed or 91-prefixed) become +91XXXXXXXXXX. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

/** "+91 99999 99999" */
export function formatPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  const indian = normalized.match(/^\+91(\d{5})(\d{5})$/);
  return indian ? `+91 ${indian[1]} ${indian[2]}` : normalized;
}

export function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
