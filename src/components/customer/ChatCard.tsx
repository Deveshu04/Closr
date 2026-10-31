"use client";

import {
  BadgeCheck,
  Check,
  CircleAlert,
  CircleX,
  Hourglass,
  LoaderCircle,
  type LucideIcon,
  ScrollText,
  SearchX,
} from "lucide-react";
import type { MomentKind } from "@/lib/types";
import type { Verdict } from "../lib/claims";
import { SourceChips } from "../moments/SearchMoment";
import { BUBBLE } from "./LiveCall";
import type { Step, Tone } from "./story";

const KIND_LABEL: Partial<Record<MomentKind, string>> = {
  understood: "Understood",
  lookup: "Account check",
  policy: "Paytm policy",
  action: "Action",
  verified: "Confirmation",
  approval: "Specialist approval",
  search: "Official rule check",
  escalated: "Specialist follow-up",
};

/** Every state carries a word and an icon, so nothing depends on colour alone. */
function statusOf(step: Step): { label: string; icon: LucideIcon; className: string } | null {
  switch (step.tone) {
    case "progress":
      return { label: "In progress", icon: LoaderCircle, className: "text-navy" };
    case "waiting":
      return { label: "Waiting", icon: Hourglass, className: "text-amber" };
    case "problem":
      return { label: "Couldn't complete", icon: CircleAlert, className: "text-brick" };
    case "handoff":
      return null;
    case "done":
      if (step.kind === "understood") return null;
      return {
        label: step.kind === "action" ? "Done" : step.kind === "approval" ? "Approved" : "Checked",
        icon: Check,
        className: "text-leaf",
      };
  }
}

const VERDICT: Record<Verdict, { label: string; icon: LucideIcon; className: string }> = {
  supported: { label: "Confirmed", icon: BadgeCheck, className: "bg-leaf-wash text-leaf" },
  not_found: { label: "Not found", icon: SearchX, className: "bg-amber-wash text-amber" },
  contradicted: { label: "Differs", icon: CircleX, className: "bg-brick-wash text-brick" },
};

const SURFACE: Record<Tone, string> = {
  progress: "border-rule bg-sheet",
  done: "border-rule bg-sheet",
  waiting: "border-amber-bright/60 bg-amber-wash/50",
  problem: "border-brick/35 bg-brick-wash/60",
  handoff: "border-navy bg-navy text-white",
};

function Tile({ step }: { step: Step }) {
  const Icon = step.icon;
  // A finished action gets the solid slab the console uses for actions, so it reads as done, not just checked.
  const tone =
    step.tone === "handoff"
      ? "bg-sky text-navy"
      : step.kind === "action" && step.tone === "done"
        ? "bg-navy text-white"
        : BUBBLE[step.tone];
  return (
    <span aria-hidden className={`relative grid size-[2.2em] shrink-0 place-items-center rounded-full ${tone}`}>
      {step.tone === "progress" ? (
        <LoaderCircle className="size-[1.1em] animate-spin motion-reduce:animate-none" />
      ) : (
        <Icon className="size-[1.1em]" strokeWidth={2.25} />
      )}
    </span>
  );
}

/** A small confirmation tucked under the card it confirms, e.g. "Confirmed with the UPI network". */
function Confirmation({ step }: { step: Step }) {
  const tone = step.tone === "problem" ? "text-brick" : step.tone === "progress" ? "text-muted" : "text-leaf";
  return (
    <p className={`mt-1.5 flex items-center gap-1.5 text-[0.8em] font-medium ${tone}`}>
      {step.tone === "progress" ? (
        <LoaderCircle aria-hidden className="size-[1.05em] animate-spin motion-reduce:animate-none" />
      ) : step.tone === "problem" ? (
        <CircleAlert aria-hidden className="size-[1.05em]" />
      ) : (
        <BadgeCheck aria-hidden className="size-[1.05em]" />
      )}
      {step.text}
    </p>
  );
}

function ClaimBody({ step }: { step: Step }) {
  const claim = step.claim;
  if (!claim) return null;
  return (
    <>
      {claim.said && (
        <p className="mt-1.5 font-serif text-[0.92em] italic leading-snug text-ink/85">
          <span className="not-italic text-muted">You said </span>&ldquo;{claim.said}&rdquo;
        </p>
      )}
      {step.detail && (
        <div className="mt-2 rounded-lg bg-paper px-3 py-2 ring-1 ring-rule">
          <p className="flex items-center gap-1.5 text-[0.72em] font-semibold uppercase tracking-[0.07em] text-navy">
            <ScrollText aria-hidden className="size-[1.1em]" />
            Official rule
          </p>
          <p className="mt-0.5 text-[0.87em] leading-relaxed text-ink">{step.detail}</p>
        </div>
      )}
      {claim.sources.length > 0 && (
        <div className="mt-2 text-[0.87em]">
          <SourceChips sources={claim.sources} />
        </div>
      )}
    </>
  );
}

/** One thing Closr did, shown in the chat as it happens, in the customer's own terms. */
export function ChatCard({ step, confirmations }: { step: Step; confirmations: Step[] }) {
  if (step.minor) return <Confirmation step={step} />;
  const handoff = step.tone === "handoff";
  const status = statusOf(step);
  const verdict = step.claim?.verdict && step.tone === "done" ? VERDICT[step.claim.verdict] : undefined;
  const badge = verdict ?? status;
  const label = KIND_LABEL[step.kind];

  return (
    <article className={`rounded-2xl border px-3.5 py-3 shadow-[0_1px_2px_rgb(19_35_63/0.05)] ${SURFACE[step.tone]}`}>
      <div className="flex items-start gap-3">
        <Tile step={step} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
            {label && (
              <p
                className={`text-[0.7em] font-semibold uppercase tracking-[0.08em] ${handoff ? "text-sky" : "text-muted"}`}
              >
                {label}
              </p>
            )}
            {badge && (
              <p
                className={`inline-flex items-center gap-1 text-[0.75em] font-semibold ${
                  verdict ? `rounded-full px-2 py-px ${verdict.className}` : badge.className
                }`}
              >
                <badge.icon
                  aria-hidden
                  className={`size-[1.1em] ${step.tone === "progress" && !verdict ? "animate-spin motion-reduce:animate-none" : ""}`}
                  strokeWidth={2.5}
                />
                {badge.label}
              </p>
            )}
          </div>
          <h3
            className={`mt-0.5 text-[0.95em] font-semibold leading-snug ${
              handoff ? "text-white" : step.tone === "problem" ? "text-brick" : "text-ink"
            }`}
          >
            {step.text}
          </h3>
          {step.claim ? (
            <ClaimBody step={step} />
          ) : (
            <>
              {step.detail && (
                <p className={`figures mt-0.5 text-[0.82em] leading-snug ${handoff ? "text-white/80" : "text-muted"}`}>
                  {step.detail}
                </p>
              )}
              {step.note && (
                <p className={`mt-1.5 text-[0.85em] leading-snug ${handoff ? "text-white/85" : "text-ink/85"}`}>{step.note}</p>
              )}
            </>
          )}
          {confirmations.map((c) => (
            <Confirmation key={c.id} step={c} />
          ))}
        </div>
      </div>
    </article>
  );
}
