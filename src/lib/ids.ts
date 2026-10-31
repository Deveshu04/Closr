import { randomInt } from "node:crypto";
import { istDateKey, istHour } from "@/lib/format";

/** Ids are read out on calls and typed back from SMS, so look-alike characters (0/O, 1/I) are left out. */
const VOICE_SAFE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function voiceSafeId(prefix: string, length = 6): string {
  let body = "";
  for (let i = 0; i < length; i += 1) body += VOICE_SAFE_ALPHABET[randomInt(VOICE_SAFE_ALPHABET.length)];
  return `${prefix}-${body}`;
}

export function randomDigits(length: number): string {
  let digits = String(randomInt(1, 10));
  for (let i = 1; i < length; i += 1) digits += String(randomInt(10));
  return digits;
}

/** One payout per subject: a repeated tool call finds this key and replays the first payout instead of paying again. */
export function payoutKey(kind: string, subjectId: string): string {
  return `${kind}:${subjectId}`;
}

/** Repeatable digits for seeded records, so their references stay the same across resets. */
export function stableDigits(seed: string, length: number): string {
  let hash = 2166136261;
  let digits = "";
  for (let round = 0; digits.length < length; round += 1) {
    for (const char of `${seed}:${round}`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    digits += String(hash % 1_000_000).padStart(6, "0");
  }
  return digits.slice(0, length);
}

/** A 12-digit UPI RRN: last digit of the year, day of the year and hour (IST), then a 6-digit sequence. */
export function upiRrn(at: Date = new Date(), sequence: string = randomDigits(6)): string {
  const [year, month, day] = istDateKey(at).split("-").map(Number);
  const dayOfYear = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return `${year % 10}${String(dayOfYear).padStart(3, "0")}${String(istHour(at)).padStart(2, "0")}${sequence}`;
}
