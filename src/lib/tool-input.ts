import { atIst, istDateKey, shiftDateKey } from "@/lib/format";

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

const AMOUNT_UNITS: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  hazaar: 1_000,
  hazar: 1_000,
  hajar: 1_000,
  sau: 100,
  hundred: 100,
  lakh: 100_000,
  lac: 100_000,
};

/** "2000", "₹2,000", "Rs 1,500.50", "2k", "15 sau", "1.5 lakh". */
export function parseAmount(text: string): number | undefined {
  const match = text
    .toLowerCase()
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)\s*(k|thousand|hazaa?r|hajar|sau|hundred|lakh|lac)?\b/);
  if (!match) return undefined;
  const value = Number(match[1]) * (match[2] ? (AMOUNT_UNITS[match[2]] ?? 1) : 1);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : undefined;
}

export function readAmount(params: ToolParams, key: string): number | undefined {
  const raw = readText(params, key);
  return raw ? parseAmount(raw) : undefined;
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

// "kal" and "parso" point both ways in Hindi; a payment or settlement being asked about is in the past.
const RELATIVE_PAST_DAYS: [RegExp, number][] = [
  [/\b(?:day before yesterday|parso|parson|parsoon)\b/, 2],
  [/\b(?:yesterday|kal|kall)\b/, 1],
  [/\b(?:today|aaj|aj|abhi)\b/, 0],
  [/\b(?:last week|pichhle hafte|pichle hafte)\b/, 7],
];

function dateKeyFrom(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}

/** A day and month with no year means the last time that date came round. */
function mostRecent(day: number, month: number, year: string | undefined, today: string): string | null {
  if (year) {
    const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year);
    return dateKeyFrom(fullYear, month, day);
  }
  const thisYear = Number(today.slice(0, 4));
  const candidate = dateKeyFrom(thisYear, month, day);
  if (!candidate) return null;
  return candidate > today ? dateKeyFrom(thisYear - 1, month, day) : candidate;
}

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3)) + 1;
}

/** Understands ISO dates, Indian day-first dates, "30 Oct", "kal", "parso", "3 din pehle" and weekday names. */
export function parsePastDate(input: string, today: string = istDateKey()): string | null {
  const text = input.trim().toLowerCase();

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return dateKeyFrom(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = text.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (dayFirst) return mostRecent(Number(dayFirst[1]), Number(dayFirst[2]), dayFirst[3], today);

  const daysAgo = text.match(/\b(\d{1,2})\s*(?:days?|din)\b/);
  if (daysAgo) return shiftDateKey(today, -Number(daysAgo[1]));

  for (const [pattern, offset] of RELATIVE_PAST_DAYS) {
    if (pattern.test(text)) return shiftDateKey(today, -offset);
  }

  const dayMonth = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,})\.?(?:,?\s+(\d{4}))?/);
  if (dayMonth && monthIndex(dayMonth[2]) > 0) {
    return mostRecent(Number(dayMonth[1]), monthIndex(dayMonth[2]), dayMonth[3], today);
  }
  const monthDay = text.match(/\b([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/);
  if (monthDay && monthIndex(monthDay[1]) > 0) {
    return mostRecent(Number(monthDay[2]), monthIndex(monthDay[1]), monthDay[3], today);
  }

  const weekday = text.split(/[^a-z]+/).find((word) => word in WEEKDAYS);
  if (weekday) {
    const todayIndex = new Date(`${today}T00:00:00Z`).getUTCDay();
    return shiftDateKey(today, -((todayIndex - WEEKDAYS[weekday] + 7) % 7));
  }
  return null;
}

const HINDI_HOURS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, chhah: 6,
  saat: 7, aath: 8, nau: 9, das: 10, dus: 10, gyarah: 11, gyara: 11, barah: 12, bara: 12,
};

const PART_OF_DAY: [RegExp, number, "am" | "pm"][] = [
  [/\b(?:morning|subah|subha|savere)\b/, 9, "am"],
  [/\b(?:afternoon|dopahar|dopehar)\b/, 13, "pm"],
  [/\b(?:evening|shaam|sham)\b/, 18, "pm"],
  [/\b(?:night|raat)\b/, 20, "pm"],
];

function clockFrom(text: string): { hour: number; minute: number } | null {
  const part = PART_OF_DAY.find(([pattern]) => pattern.test(text));
  const digits =
    text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|baje|bje|o'?clock|hrs?)/) ??
    text.match(/\b(\d{1,2})[:.](\d{2})\b/);
  const unit = digits?.[3] ?? "";
  const meridiem = unit.startsWith("a") ? "am" : unit.startsWith("p") ? "pm" : part?.[2];

  let hour: number | undefined;
  let minute = 0;
  if (digits) {
    hour = Number(digits[1]);
    minute = digits[2] ? Number(digits[2]) : 0;
  } else {
    const spoken = text.match(/\b(dedh|dhai|dhaai|saadhe\s+[a-z]+|[a-z]+)\s+baje\b/);
    if (spoken) {
      const word = spoken[1];
      if (word === "dedh") [hour, minute] = [1, 30];
      else if (word === "dhai" || word === "dhaai") [hour, minute] = [2, 30];
      else if (word.startsWith("saadhe")) [hour, minute] = [HINDI_HOURS[word.split(/\s+/)[1]] ?? Number.NaN, 30];
      else hour = HINDI_HOURS[word];
    }
  }
  if (hour === undefined || !Number.isFinite(hour)) {
    return part ? { hour: part[1], minute: 0 } : null;
  }
  if (hour > 23 || minute > 59) return null;
  if (hour <= 12) {
    // A shop's day runs 8 am to 10 pm, so "2 baje" without am/pm means the afternoon.
    const pm = meridiem === "pm" || (meridiem === undefined && hour < 8);
    hour = pm ? (hour % 12) + 12 : hour % 12 === 0 && meridiem === "am" ? 0 : hour;
  }
  return { hour, minute };
}

/** "2 baje se", "since 2:30 pm", "kal shaam", "subah se", "yesterday": the moment that window opens. */
export function parseSince(input: string, now: Date = new Date()): Date | null {
  const text = input.trim().toLowerCase();
  const today = istDateKey(now);
  const day = parsePastDate(text, today);
  const clock = clockFrom(text);
  if (!clock) return day ? atIst(day, 0) : null;

  const at = atIst(day ?? today, clock.hour, clock.minute);
  return !day && at > now ? atIst(shiftDateKey(today, -1), clock.hour, clock.minute) : at;
}
