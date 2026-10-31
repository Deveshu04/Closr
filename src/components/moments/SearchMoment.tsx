"use client";

import { ExternalLink, Globe, Info, Landmark, LoaderCircle, ScrollText, Search } from "lucide-react";
import { motion } from "motion/react";
import type { Moment } from "@/lib/types";
import { type Source, type Verdict, publisherOf, readSources, readVerdict } from "../lib/claims";
import { pickString } from "../lib/data";
import { StatusNote, surfaceFor } from "./shared";

const VERDICTS: Record<Verdict, { word: string; note: string; stamp: string; accent: string }> = {
  supported: {
    word: "Confirmed",
    note: "An official source states this rule",
    stamp: "border-leaf text-leaf bg-leaf-wash/60",
    accent: "border-l-leaf",
  },
  not_found: {
    word: "Not found",
    note: "No official source states this rule",
    stamp: "border-amber text-amber bg-amber-wash",
    accent: "border-l-amber-bright",
  },
  contradicted: {
    word: "Contradicted",
    note: "Official sources say otherwise",
    stamp: "border-brick text-brick bg-brick-wash",
    accent: "border-l-brick",
  },
};

export function SourceChips({ sources }: { sources: Source[] }) {
  return (
    <ul aria-label="Sources" className="flex flex-wrap gap-2">
      {sources.map((s) => (
        <li key={s.href} className="min-w-0 max-w-full">
          <a
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            title={s.href}
            className="group inline-flex max-w-full items-center gap-2 rounded-full border border-rule bg-sheet py-1 pl-1 pr-2.5 text-[13px] transition-colors hover:border-sky hover:bg-sky-wash"
          >
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-navy px-1.5 text-[10px] font-bold tracking-wide text-white">
              {publisherOf(s.host)}
            </span>
            <span className="truncate font-medium text-navy">{s.title}</span>
            <span className="hidden shrink-0 text-muted sm:inline">{s.host}</span>
            <ExternalLink aria-hidden size={12} className="shrink-0 text-faint group-hover:text-navy" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A rule the customer cited, checked against official sources and stamped with the verdict. */
function ClaimCheck({ moment, verdict }: { moment: Moment; verdict: Verdict | undefined }) {
  const claim = pickString(moment.data, "claim", "query") ?? moment.detail ?? moment.title;
  const answer = verdict ? pickString(moment.data, "answer", "officialRule", "summary") ?? moment.detail : undefined;
  const sources = readSources(moment);
  const running = moment.status === "running";
  const failed = moment.status === "failed";
  const meta = verdict ? VERDICTS[verdict] : undefined;

  return (
    <article
      className={`overflow-hidden rounded-lg border border-l-4 border-rule bg-sheet shadow-[0_1px_2px_rgb(0_46_110/0.06),0_14px_30px_-22px_rgb(0_33_79/0.45)] ${
        meta?.accent ?? "border-l-navy/30"
      }`}
    >
      <header className="flex items-center gap-2 bg-navy px-4 py-2 text-white">
        <Landmark aria-hidden size={15} className="shrink-0 text-sky" />
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em]">Claim check</h3>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/60">against RBI and NPCI sources</span>
        {running && (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-sky">
            <LoaderCircle aria-hidden size={13} className="animate-spin motion-reduce:animate-none" />
            Checking
          </span>
        )}
      </header>

      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 px-4 pb-3 pt-3.5">
        <figure className="min-w-[12rem] flex-1">
          <figcaption className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint">The customer said</figcaption>
          <blockquote className="mt-1 font-serif text-[1.1875rem] italic leading-snug text-ink [font-variation-settings:'opsz'_28]">
            &ldquo;{claim}&rdquo;
          </blockquote>
        </figure>
        {meta && (
          <div className="shrink-0 text-right">
            <motion.p
              initial={{ opacity: 0, scale: 1.6, rotate: -14 }}
              animate={{ opacity: 1, scale: 1, rotate: -4 }}
              transition={{ type: "spring", stiffness: 480, damping: 18, delay: 0.1 }}
              className={`stamp-face inline-block rounded-md border-[3px] px-3 py-0.5 text-[1.375rem] font-bold uppercase leading-tight ${meta.stamp}`}
            >
              {meta.word}
            </motion.p>
            <p className="mt-1.5 text-[12px] font-medium text-muted">{meta.note}</p>
          </div>
        )}
      </div>

      {answer && (
        <div className="mx-4 rounded-md bg-paper px-3.5 py-3 ring-1 ring-rule">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-navy">
            <ScrollText aria-hidden size={13} />
            Official rule
          </p>
          <p className="mt-1 max-w-[64ch] font-serif text-[16.5px] leading-relaxed text-ink">{answer}</p>
        </div>
      )}

      {failed && (
        <p className="mx-4 rounded-md bg-amber-wash px-3.5 py-2.5 text-[14px] text-ink">
          Couldn&apos;t reach official sources, so Closr went by Paytm&apos;s published policy.
        </p>
      )}

      <footer className="px-4 pb-3.5 pt-3">
        {sources.length > 0 && <SourceChips sources={sources} />}
        {verdict && sources.length === 0 && (
          <p className="text-[13px] text-muted">No official page cites this rule.</p>
        )}
        {!running && (
          <p className="mt-2.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-muted">
            <Info aria-hidden size={13} className="mt-0.5 shrink-0" />
            For information only: a verdict never changes a policy decision or an action.
          </p>
        )}
      </footer>
    </article>
  );
}

/** A web lookup, drawn like a search result: the query, the spoken answer, and where it came from. */
export function SearchMoment({ moment }: { moment: Moment }) {
  const verdict = readVerdict(moment);
  if (verdict || pickString(moment.data, "claim")) return <ClaimCheck moment={moment} verdict={verdict} />;

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
          <div className="mt-3 border-t border-rule pt-3">
            <SourceChips sources={sources} />
          </div>
        )}
      </div>
    </article>
  );
}
