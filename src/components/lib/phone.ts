/** Accepts a 10-digit Indian mobile, optionally prefixed with +91, 91 or 0. Returns +91XXXXXXXXXX or null. */
export function normalizeIndianMobile(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.startsWith("+") && !trimmed.replace(/[\s-]/g, "").startsWith("+91")) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/** +919876543210 → +91 98765 43210 */
export function displayIndianMobile(normalized: string): string {
  const local = normalized.slice(3);
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}
