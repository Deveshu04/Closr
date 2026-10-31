"use client";

import { Info } from "lucide-react";
import { motion } from "motion/react";
import { useId } from "react";
import type { OutcomeMetrics } from "@/lib/types";
import { useMetrics } from "./hooks/useMetrics";
import { inr } from "./lib/format";

const VERIFIED_RULE = "A resolution counts only when the system change was re-read from the source system.";

interface Tile {
  label: string;
  /** For phone widths, where three tiles share a row. */
  short?: string;
  value: string;
  badge?: string;
  note: string;
  title?: string;
}

function resolveTime(seconds: number | null): string {
  if (seconds === null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
}

function tilesFor(m: OutcomeMetrics | null): Tile[] {
  const count = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("en-IN"));
  const rate = m?.autonomousRate;
  return [
    { label: "Conversations", value: count(m?.conversations), note: "Calls and chats" },
    {
      label: "Resolved by Closr",
      value: count(m?.resolvedAutonomously),
      badge: rate === null || rate === undefined ? undefined : `${Math.round(rate * 100)}%`,
      note: "No person needed",
      title: "Verified, with no handoff and no approval",
    },
    {
      label: "Verified outcomes",
      value: count(m?.verifiedResolutions),
      note: "Re-read from source",
      title: VERIFIED_RULE,
    },
    {
      label: "Money returned",
      value: m ? inr(m.moneyReturned) : "—",
      note: m?.disputesRaised ? `+ ${plural(m.disputesRaised, "UPI dispute", "UPI disputes")} raised` : "Payouts processed",
    },
    {
      label: "Escalated to a person",
      short: "Escalated",
      value: count(m?.escalations),
      note: m?.approvals.requested
        ? `+ ${plural(m.approvals.requested, "one-tap approval", "one-tap approvals")}`
        : "Handoffs with a brief",
    },
    { label: "Avg time to resolve", value: m ? resolveTime(m.avgResolutionSec) : "—", note: "Start to verified fix" },
  ];
}

/** Rolls a changed number in, so a new outcome is noticed without a chart. */
function Figure({ value }: { value: string }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0.35, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      className="inline-block"
    >
      {value}
    </motion.span>
  );
}

/** What Closr has achieved across every call and chat, refreshed every few seconds. */
export function OutcomesStrip({ trigger }: { trigger: string }) {
  const metrics = useMetrics(trigger);
  const tipId = useId();
  const tiles = tilesFor(metrics);

  return (
    <section
      aria-labelledby="outcomes-heading"
      className="flex flex-col gap-x-6 gap-y-2 border-b border-rule bg-sheet px-4 py-2.5 sm:px-5 lg:px-8 xl:flex-row xl:items-center"
    >
      <div className="flex shrink-0 items-baseline gap-2 xl:w-40 xl:flex-col xl:gap-0.5">
        <h2 id="outcomes-heading" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-navy">
          Outcomes
        </h2>
        <span
          tabIndex={0}
          aria-describedby={tipId}
          className="group relative inline-flex cursor-help items-center gap-1 rounded text-[12.5px] text-muted focus:outline-none focus-visible:outline-2 focus-visible:outline-sky"
        >
          All calls and chats
          <Info aria-hidden size={13} className="text-faint" />
          <span
            id={tipId}
            role="tooltip"
            className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 w-60 rounded-md bg-navy px-2.5 py-1.5 text-xs font-medium leading-snug text-white opacity-0 shadow-[0_10px_24px_-10px_rgb(0_0_0/0.5)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {VERIFIED_RULE}
          </span>
        </span>
      </div>
      <dl className="grid flex-1 grid-cols-3 gap-x-3 gap-y-3 lg:grid-cols-6 lg:gap-x-0 lg:divide-x lg:divide-rule">
        {tiles.map((tile) => (
          <div key={tile.label} title={tile.title} className="flex min-w-0 flex-col lg:px-4 lg:first:pl-0">
            <dt className="text-[12px] font-medium leading-tight text-muted lg:truncate">
              {tile.short ? (
                <>
                  <span className="sm:hidden">{tile.short}</span>
                  <span className="max-sm:hidden">{tile.label}</span>
                </>
              ) : (
                tile.label
              )}
            </dt>
            <dd className="figures mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[1.25rem] font-semibold leading-none text-navy sm:text-[1.375rem]">
              <Figure value={tile.value} />
              {tile.badge && (
                <span className="rounded-full bg-sky-wash px-1.5 py-0.5 text-[11.5px] font-semibold leading-none text-navy ring-1 ring-inset ring-sky/40">
                  {tile.badge}
                </span>
              )}
            </dd>
            <dd className="mt-1 hidden text-[11.5px] leading-tight text-faint sm:block lg:truncate">{tile.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
