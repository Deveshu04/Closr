const IST = "Asia/Kolkata";

const inrWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const inrPaise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function inr(amount: number | undefined): string {
  if (amount === undefined || !Number.isFinite(amount)) return "—";
  return Number.isInteger(amount) ? inrWhole.format(amount) : inrPaise.format(amount);
}

function toDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function clockTime(iso: string | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  return d.toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/** "2:14 pm" */
export function timeOfDay(iso: string | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  return d.toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" });
}

export function shortDateTime(iso: string | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  return d.toLocaleString("en-IN", { timeZone: IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function shortDate(iso: string | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short" });
}

/** "Wed, 4 Nov" */
export function weekdayDate(iso: string | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" });
}

/** "2026-09" → "Sep 2026" */
export function billingMonth(period: string): string {
  const d = new Date(`${period}-15T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? period
    : d.toLocaleDateString("en-IN", { timeZone: IST, month: "short", year: "numeric" });
}

export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Long references (RRN, UTR, MID) are shown by their last four; the full value goes in a title. */
export function lastFour(value: string | undefined): string {
  const tail = value?.replace(/\s/g, "").slice(-4);
  return tail ? `••${tail}` : "—";
}

const ACRONYMS =
  /\b(vip|upi|utr|rrn|gst|gstin|id|crm|eta|emi|kyc|otp|mid|udir|npci|rbi|sim|ifsc|vpa|p2p|p2m|tat|sms)\b/g;

/** "refund_status" / "kycStatus" / "upi" → "Refund status" / "KYC status" / "UPI" */
export function humanize(token: string): string {
  const spaced = token
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
    .replace(ACRONYMS, (m) => m.toUpperCase());
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}
