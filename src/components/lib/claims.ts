import type { Moment } from "@/lib/types";
import { isRecord, pickArray, pickString, safeHttpUrl } from "./data";

/** Where a claim check landed against official RBI / NPCI sources. */
export type Verdict = "supported" | "not_found" | "contradicted";

export interface Source {
  href: string;
  title: string;
  host: string;
}

const PUBLISHERS: Record<string, string> = {
  "rbi.org.in": "RBI",
  "npci.org.in": "NPCI",
  "paytm.com": "Paytm",
  "paytmbank.com": "PPBL",
  "meity.gov.in": "MeitY",
  "india.gov.in": "GOI",
};

export function readVerdict(moment: Moment): Verdict | undefined {
  const raw = pickString(moment.data, "verdict")?.toLowerCase().replace(/[\s-]+/g, "_");
  return raw === "supported" || raw === "not_found" || raw === "contradicted" ? raw : undefined;
}

/** Only http(s) links, deduplicated, at most five. */
export function readSources(moment: Moment): Source[] {
  const out: Source[] = [];
  for (const raw of pickArray(moment.data, "sources")) {
    const link = typeof raw === "string" ? raw : isRecord(raw) ? pickString(raw, "url", "link", "href") : undefined;
    const url = safeHttpUrl(link);
    if (!url || out.some((s) => s.href === url.href)) continue;
    const host = url.hostname.replace(/^www\./, "");
    const title = (isRecord(raw) ? pickString(raw, "title", "name") : undefined) ?? host;
    out.push({ href: url.href, title, host });
  }
  return out.slice(0, 5);
}

/** "rbi.org.in" → "RBI"; an unknown host falls back to its first letter. */
export function publisherOf(host: string): string {
  const known = Object.entries(PUBLISHERS).find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  return known ? known[1] : host.charAt(0).toUpperCase();
}
