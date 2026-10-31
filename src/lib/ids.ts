import { randomInt } from "node:crypto";

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
