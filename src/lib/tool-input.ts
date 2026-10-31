import { istDateKey, shiftDateKey } from "@/lib/format";
import { DELIVERY_SLOTS } from "@/lib/policy";

export type ToolParams = Record<string, unknown>;

const WRAPPER_KEYS = ["args", "arguments", "parameters", "params", "input", "tool_input", "data", "body"];

/**
 * When the LLM skips an optional parameter, Bolna still sends it: empty, or as the raw
 * template it failed to fill ("%(slot)s", "{slot}", "{{slot}}"). Those mean "not given".
 */
const UNFILLED = /^(?:null|undefined|none|nil|n\/a|%\(.*\)s|\{\{.*\}\}|\{.*\})$/i;

function asRecord(value: unknown): ToolParams | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as ToolParams) : null;
}

function parseJsonObject(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim().startsWith("{")) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Flattens params nested under common wrapper keys (as objects or JSON strings); nested values win. */
export function unwrapToolParams(body: unknown): ToolParams {
  const root = asRecord(parseJsonObject(body));
  if (!root) return {};
  const params: ToolParams = {};
  for (const [key, value] of Object.entries(root)) {
    if (!WRAPPER_KEYS.includes(key)) params[key] = value;
  }
  for (const key of WRAPPER_KEYS) {
    const nested = asRecord(parseJsonObject(root[key]));
    if (nested) Object.assign(params, unwrapToolParams(nested));
  }
  return params;
}

export function readText(params: ToolParams, key: string): string | undefined {
  const value = params[key];
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && !UNFILLED.test(trimmed) ? trimmed : undefined;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, ravivar: 0, raviwar: 0, itvaar: 0, itwar: 0,
  monday: 1, mon: 1, somvar: 1, somwar: 1,
  tuesday: 2, tue: 2, tues: 2, mangalvar: 2, mangalwar: 2,
  wednesday: 3, wed: 3, budhvar: 3, budhwar: 3,
  thursday: 4, thu: 4, thurs: 4, guruvar: 4, guruwar: 4, brihaspativar: 4,
  friday: 5, fri: 5, shukravar: 5, shukrawar: 5,
  saturday: 6, sat: 6, shanivar: 6, shaniwar: 6,
};

// "kal" means both yesterday and tomorrow in Hindi; for a delivery date it can only be tomorrow.
const RELATIVE_DAYS: [RegExp, number][] = [
  [/\b(?:day after tomorrow|parso|parson|parsoon)\b/, 2],
  [/\b(?:tomorrow|tmrw|tomorow|kal)\b/, 1],
  [/\b(?:today|aaj)\b/, 0],
];

function dateKeyFrom(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}

/** A day and month with no year means the next time that date comes round. */
function upcoming(day: number, month: number, year: string | undefined, today: string): string | null {
  if (year) {
    const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year);
    return dateKeyFrom(fullYear, month, day);
  }
  const thisYear = Number(today.slice(0, 4));
  const candidate = dateKeyFrom(thisYear, month, day);
  if (!candidate) return null;
  return candidate < today ? dateKeyFrom(thisYear + 1, month, day) : candidate;
}

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3)) + 1;
}

/** Understands ISO dates, Indian day-first dates, "2 Nov", "kal", "parso", "in 3 days" and weekday names. */
export function parseDeliveryDate(input: string, today: string = istDateKey()): string | null {
  const text = input.trim().toLowerCase();

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return dateKeyFrom(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = text.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (dayFirst) return upcoming(Number(dayFirst[1]), Number(dayFirst[2]), dayFirst[3], today);

  const inDays = text.match(/\b(\d{1,2})\s*(?:days?|din)\b/);
  if (inDays) return shiftDateKey(today, Number(inDays[1]));

  for (const [pattern, offset] of RELATIVE_DAYS) {
    if (pattern.test(text)) return shiftDateKey(today, offset);
  }

  const dayMonth = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,})\.?(?:,?\s+(\d{4}))?/);
  if (dayMonth && monthIndex(dayMonth[2]) > 0) {
    return upcoming(Number(dayMonth[1]), monthIndex(dayMonth[2]), dayMonth[3], today);
  }
  const monthDay = text.match(/\b([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/);
  if (monthDay && monthIndex(monthDay[1]) > 0) {
    return upcoming(Number(monthDay[2]), monthIndex(monthDay[1]), monthDay[3], today);
  }

  const weekday = text.split(/[^a-z]+/).find((word) => word in WEEKDAYS);
  if (weekday) {
    const todayIndex = new Date(`${today}T00:00:00Z`).getUTCDay();
    const ahead = (WEEKDAYS[weekday] - todayIndex + 7) % 7 || 7;
    return shiftDateKey(today, ahead);
  }

  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? istDateKey(new Date(parsed)) : null;
}

const SLOT_KEYWORDS: [RegExp, number][] = [
  [/\b(?:morning|subah|savere|subha)\b/, 0],
  [/\b(?:afternoon|dopahar|dopehar|lunch)\b/, 1],
  [/\b(?:evening|shaam|sham)\b/, 2],
  [/\b(?:night|raat|late)\b/, 3],
];

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function to24Hour(hour: number, meridiem: string | undefined): number {
  const base = hour % 12;
  if (meridiem === "pm") return base + 12;
  if (meridiem === "am") return base;
  // Without am/pm, a delivery hour below 9 can only mean afternoon or evening.
  return base < 9 ? base + 12 : base;
}

/** Maps "morning", "shaam ko", "3 to 6 pm" or an exact label onto the courier slot that fits best. */
export function parseSlot(input: string): string | null {
  const exact = DELIVERY_SLOTS.find((slot) => squash(slot.label) === squash(input));
  if (exact) return exact.label;

  const text = input.toLowerCase();
  const keyword = SLOT_KEYWORDS.find(([pattern]) => pattern.test(text));
  if (keyword) return DELIVERY_SLOTS[keyword[1]].label;

  const times = [...text.matchAll(/(\d{1,2})(?::\d{2})?\s*(am|pm)?/g)].slice(0, 2);
  if (times.length === 0) return null;
  const start = to24Hour(Number(times[0][1]), times[0][2] ?? times.at(-1)?.[2]);
  if (times.length === 1) return DELIVERY_SLOTS.find((slot) => start < slot.endHour)?.label ?? null;

  let end = to24Hour(Number(times[1][1]), times[1][2]);
  if (end <= start) end += 12;
  const overlap = (slot: (typeof DELIVERY_SLOTS)[number]) =>
    Math.min(end, slot.endHour) - Math.max(start, slot.startHour);
  const best = [...DELIVERY_SLOTS].sort((a, b) => overlap(b) - overlap(a))[0];
  return overlap(best) > 0 ? best.label : null;
}

/** Digits only, so "110 020" and 110020 both work; validity is the address policy's call. */
export function readPincode(params: ToolParams, key: string): string | undefined {
  const raw = readText(params, key);
  return raw ? raw.replace(/\D/g, "") : undefined;
}
