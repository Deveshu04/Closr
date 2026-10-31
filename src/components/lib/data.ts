import { humanize, inr, isIsoDate, lastFour, shortDateTime } from "./format";

export type Data = Record<string, unknown> | undefined;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First key holding a non-empty string (numbers are stringified). */
export function pickString(data: Data, ...keys: string[]): string | undefined {
  if (!data) return undefined;
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

export function pickNumber(data: Data, ...keys: string[]): number | undefined {
  if (!data) return undefined;
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

export function pickArray(data: Data, key: string): unknown[] {
  const v = data?.[key];
  return Array.isArray(v) ? v : [];
}

export function pickRecord(data: Data, key: string): Record<string, unknown> | undefined {
  const v = data?.[key];
  return isRecord(v) ? v : undefined;
}

export function safeHttpUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const MONEY_KEY = /amount|total|price|cashback|^rent|Rent|principal|outstanding|deposit|monthly|^emi|Emi|refund(?!id)/i;
const REF_KEY = /^(rrn|utr|mid)$|(Rrn|Utr|Mid|_rrn|_utr|_mid)$/;
const TOKEN_KEY =
  /status|state|stage|reason|intent|method|outcome|priority|sentiment|language|kind|type|verdict|channel|category|code|signal|direction|product|mode/i;
const MAX_TEXT = 90;

function formatScalar(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (REF_KEY.test(key) && (typeof value === "string" || typeof value === "number")) return lastFour(String(value));
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return MONEY_KEY.test(key) ? inr(value) : value.toLocaleString("en-IN");
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    if (isIsoDate(text)) return shortDateTime(text);
    if (TOKEN_KEY.test(key) && /^[a-z]+(?:[_-][a-z]+)*$/.test(text)) return humanize(text);
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      const shown = value.slice(0, 3).join(", ");
      return value.length > 3 ? `${shown} +${value.length - 3}` : shown;
    }
    const names = value
      .map((v) => (isRecord(v) ? pickString(v, "name", "title", "id") : undefined))
      .filter((v): v is string => Boolean(v));
    if (names.length) return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
    return `${value.length} items`;
  }
  return null;
}

/** Lowercases the first letter unless the first word is an acronym ("QC status" stays). */
function lowerFirst(label: string): string {
  return /^[A-Z]{2,}\b/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

export interface Field {
  label: string;
  value: string;
  /** The unabbreviated value, for references shown by their last four. */
  full?: string;
}

function fieldOf(label: string, key: string, raw: unknown, value: string): Field {
  return REF_KEY.test(key) ? { label, value, full: String(raw) } : { label, value };
}

/**
 * Turns an arbitrary tool payload into a short list of readable fields.
 * A `fields` object, when the backend sends one, is used verbatim; otherwise top-level
 * scalars come first and one level of nested objects is flattened after them.
 */
export function keyFields(data: Data, exclude: readonly string[] = [], limit = 8): Field[] {
  if (!data) return [];
  const curated = pickRecord(data, "fields");
  const source = curated ?? data;
  const skip = new Set([...exclude, "fields", "touched", "checks", "sources", "informationOnly", "idempotencyKey"]);
  const out: Field[] = [];

  for (const [key, value] of Object.entries(source)) {
    if (out.length >= limit) break;
    if (skip.has(key) || isRecord(value)) continue;
    const formatted = formatScalar(key, value);
    if (formatted) out.push(fieldOf(curated ? key : humanize(key), key, value, formatted));
  }
  if (curated) return out;

  for (const [key, value] of Object.entries(source)) {
    if (out.length >= limit) break;
    if (skip.has(key) || !isRecord(value)) continue;
    for (const [sub, inner] of Object.entries(value)) {
      if (out.length >= limit) break;
      if (isRecord(inner)) continue;
      const formatted = formatScalar(sub, inner);
      if (formatted) out.push(fieldOf(`${humanize(key)} ${lowerFirst(humanize(sub))}`, sub, inner, formatted));
    }
  }
  return out;
}
