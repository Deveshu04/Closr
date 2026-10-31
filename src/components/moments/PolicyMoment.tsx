"use client";

import { Check, ScrollText, X } from "lucide-react";
import { motion } from "motion/react";
import type { Moment, MomentStatus, PolicyDecision } from "@/lib/types";
import { isRecord, pickArray, pickString } from "../lib/data";
import { StatusNote, surfaceFor } from "./shared";

type Outcome = PolicyDecision["outcome"];
type PolicyCheck = PolicyDecision["checks"][number];

const STEP_S = 0.14;

const VERDICT: Record<Outcome, { word: string; className: string }> = {
  allow: { word: "Allow", className: "border-leaf text-leaf" },
  needs_approval: { word: "Needs approval", className: "border-amber text-amber bg-amber-wash" },
  deny: { word: "Deny", className: "border-brick text-brick" },
};

function readChecks(moment: Moment): PolicyCheck[] {
  return pickArray(moment.data, "checks")
    .filter(isRecord)
    .map((c) => ({
      rule: typeof c.rule === "string" && c.rule ? c.rule : "Rule",
      passed: c.passed === true,
      note: typeof c.note === "string" ? c.note : "",
    }));
}

function readOutcome(moment: Moment): Outcome | undefined {
  const raw = pickString(moment.data, "outcome", "decision", "verdict")?.toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "allow" || raw === "allowed") return "allow";
  if (raw === "needs_approval" || raw === "approval" || raw === "needs_human") return "needs_approval";
  if (raw === "deny" || raw === "denied") return "deny";
  const fallback: Partial<Record<MomentStatus, Outcome>> = {
    ok: "allow",
    waiting: "needs_approval",
    blocked: "deny",
  };
  return fallback[moment.status];
}

/** The rules the agent checked, ticked off one by one, ending in a stamped verdict. */
export function PolicyMoment({ moment }: { moment: Moment }) {
  const checks = readChecks(moment);
  const outcome = moment.status === "running" ? undefined : readOutcome(moment);
  const reasons = pickArray(moment.data, "reasons").filter((r): r is string => typeof r === "string");
  const footnote = moment.detail ?? reasons[0];
  const verdictDelay = checks.length * STEP_S + 0.1;

  return (
    <article className={`rounded-lg border border-rule bg-sheet ${surfaceFor(moment.status === "waiting" ? "ok" : moment.status)}`}>
      <header className="flex items-center gap-2 border-b border-rule px-4 py-2.5">
        <ScrollText aria-hidden size={16} className="shrink-0 text-navy" />
        <h3 className="min-w-0 flex-1 text-[17px] font-semibold leading-snug text-ink">{moment.title}</h3>
        <StatusNote status={moment.status === "waiting" ? "ok" : moment.status} />
      </header>

      {checks.length > 0 && (
        <ul className="px-4">
          {checks.map((c, i) => (
            <motion.li
              key={`${c.rule}-${i}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * STEP_S, duration: 0.25 }}
              className="flex gap-3 border-b border-rule/70 py-2.5 last:border-b-0"
            >
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: i * STEP_S + 0.08, type: "spring", stiffness: 600, damping: 22 }}
                className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white ${c.passed ? "bg-leaf" : "bg-brick"}`}
              >
                {c.passed ? (
                  <Check aria-label="Passed" size={13} strokeWidth={3} />
                ) : (
                  <X aria-label="Failed" size={13} strokeWidth={3} />
                )}
              </motion.span>
              <div className="min-w-0">
                <p className={`text-[15px] font-medium leading-snug ${c.passed ? "text-ink" : "text-brick"}`}>{c.rule}</p>
                {c.note && <p className="text-sm leading-snug text-muted">{c.note}</p>}
              </div>
            </motion.li>
          ))}
        </ul>
      )}

      {(outcome || footnote) && (
        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-dashed border-rule px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-muted">{footnote}</p>
          {outcome && (
            <motion.span
              initial={{ opacity: 0, scale: 1.35 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: verdictDelay, type: "spring", stiffness: 500, damping: 20 }}
              className={`stamp-face rounded-[3px] border-2 px-2.5 py-0.5 text-lg font-bold uppercase leading-tight ${VERDICT[outcome].className}`}
            >
              {VERDICT[outcome].word}
            </motion.span>
          )}
        </footer>
      )}
    </article>
  );
}
