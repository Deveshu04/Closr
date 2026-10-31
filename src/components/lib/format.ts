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
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function shortDateTime(iso: string | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function shortDate(iso: string | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** "Wed, 4 Nov" */
export function weekdayDate(iso: string | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function msSince(iso: string | undefined, now: number): number {
  const d = toDate(iso);
  return d ? Math.max(0, now - d.getTime()) : 0;
}

export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const ACRONYMS = /\b(vip|upi|cod|utr|gst|gstin|awb|qc|id|crm|eta|rto|emi|kyc|ltv|otp)\b/g;

/** "refund_status" / "qcStatus" / "vip" → "Refund status" / "QC status" / "VIP" */
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
