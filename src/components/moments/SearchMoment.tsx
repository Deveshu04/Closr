import { ExternalLink, Globe, Search } from "lucide-react";
import type { Moment } from "@/lib/types";
import { isRecord, pickArray, pickString, safeHttpUrl } from "../lib/data";
import { StatusNote, surfaceFor } from "./shared";

interface Source {
  href: string;
  title: string;
  host: string;
}

function readSources(moment: Moment): Source[] {
  const out: Source[] = [];
  for (const raw of pickArray(moment.data, "sources")) {
    const link = typeof raw === "string" ? raw : isRecord(raw) ? pickString(raw, "url", "link", "href") : undefined;
    const url = safeHttpUrl(link);
    if (!url) continue;
    const host = url.hostname.replace(/^www\./, "");
    const title = (isRecord(raw) ? pickString(raw, "title", "name") : undefined) ?? host;
    out.push({ href: url.href, title, host });
  }
  return out.slice(0, 5);
}

/** A web lookup, drawn like a search result: the query, the spoken answer, and where it came from. */
export function SearchMoment({ moment }: { moment: Moment }) {
  const query = pickString(moment.data, "query", "q", "question") ?? moment.title;
  const answer = pickString(moment.data, "answer", "summary", "result") ?? moment.detail;
  const sources = readSources(moment);

  return (
    <article className={`overflow-hidden rounded-lg border border-rule bg-sheet ${surfaceFor(moment.status)}`}>
      <div className="flex items-center gap-2.5 border-b border-rule bg-paper/80 px-3.5 py-2">
        <Search aria-hidden size={15} className="shrink-0 text-muted" />
        <p className="min-w-0 flex-1 truncate text-[15px] text-ink" title={query}>
          {query}
        </p>
        <StatusNote status={moment.status} />
        <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-muted">
          <Globe aria-hidden size={13} />
          Web
        </span>
      </div>
      <div className="px-4 py-3">
        {query !== moment.title && <p className="text-sm font-medium text-muted">{moment.title}</p>}
        {answer && <p className="mt-1 max-w-[64ch] font-serif text-[17px] leading-relaxed text-ink">{answer}</p>}
        {sources.length > 0 && (
          <ol className="mt-3 space-y-1.5 border-t border-rule pt-2.5">
            {sources.map((s, i) => (
              <li key={s.href} className="flex min-w-0 items-baseline gap-2 text-sm">
                <span className="figures w-4 shrink-0 text-right text-faint">{i + 1}</span>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex min-w-0 items-baseline gap-2 text-navy"
                >
                  <span className="truncate font-medium underline decoration-navy/25 underline-offset-2 group-hover:decoration-navy">
                    {s.title}
                  </span>
                  <span className="shrink-0 text-muted">{s.host}</span>
                  <ExternalLink aria-hidden size={12} className="shrink-0 self-center text-faint" />
                </a>
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}
