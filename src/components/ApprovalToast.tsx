"use client";

import { Hand } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ApprovalButtons } from "./ApprovalButtons";
import { type ApprovalControls, effectiveStatus } from "./hooks/useApprovals";
import { inr } from "./lib/format";

/** Pending approvals pinned to the corner of the screen, so a human can answer from anywhere. */
export function ApprovalToast({ controls }: { controls: ApprovalControls }) {
  const pending = controls.approvals.filter(
    (a) => effectiveStatus(a, controls.decisions[a.id]) === "pending",
  );

  return (
    <div
      role="region"
      aria-label="Pending approvals"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-stretch gap-3 p-3 sm:items-end sm:p-6"
    >
      <AnimatePresence>
        {pending.map((a) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="pointer-events-auto w-full overflow-hidden rounded-xl border-2 border-amber-bright bg-sheet shadow-[0_28px_60px_-24px_rgb(0_33_79/0.55)] sm:w-[26rem]"
          >
            <div className="flex items-start gap-3 bg-amber-wash px-4 py-3">
              <span className="is-waiting mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-amber-bright text-white">
                <Hand aria-hidden size={18} strokeWidth={2.25} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber">Closr needs your approval</p>
                <p className="mt-0.5 line-clamp-3 text-[15px] leading-snug text-ink">{a.brief || a.reason}</p>
                {a.orderId && <p className="figures mt-0.5 text-xs text-muted">{a.orderId}</p>}
              </div>
              <p className="figures shrink-0 font-serif text-2xl font-semibold leading-none text-ink">{inr(a.amount)}</p>
            </div>
            <div className="px-4 py-3">
              <ApprovalButtons approval={a} controls={controls} size="md" />
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
