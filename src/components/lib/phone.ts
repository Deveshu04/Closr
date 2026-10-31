/** Accepts a 10-digit Indian mobile, optionally prefixed with +91, 91 or 0. Returns +91XXXXXXXXXX or null. */
export function normalizeIndianMobile(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.startsWith("+") && !trimmed.replace(/[\s-]/g, "").startsWith("+91")) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/** For a field that already shows a fixed "+91": "+91 98765 43210" → "98765 43210". */
export function withoutCountryCode(input: string): string {
  return input.replace(/^\s*\+91[\s-]*/, "");
}

/** Any Indian number → "+91 •••• ••7292", for lists that shouldn't expose the full number. */
export function maskIndianMobile(phone: string): string {
  const last4 = phone.replace(/\D/g, "").slice(-4);
  return last4.length === 4 ? `+91 •••• ••${last4}` : "—";
}

/** +919876543210 → +91 98765 43210 */
export function displayIndianMobile(normalized: string): string {
  const local = normalized.slice(3);
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}
