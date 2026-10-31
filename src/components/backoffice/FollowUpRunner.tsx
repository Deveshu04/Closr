"use client";

import { CircleAlert, FastForward, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { runFollowUps } from "../lib/api";

/** Demo time-skip: a check-back is due days later, so this plays the scheduled ones now. */
export function FollowUpRunner({ scheduled, onRan }: { scheduled: number; onRan: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    const outcome = await runFollowUps();
    setBusy(false);
    if (outcome.ok) {
      const ran = outcome.ran ?? 0;
      setResult({ ok: true, text: ran ? `Ran ${ran} ${ran === 1 ? "follow-up" : "follow-ups"}` : "Nothing was due" });
    } else {
      setResult({ ok: false, text: outcome.error });
    }
    onRan();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-paper/70 px-5 py-2.5">
      <p className="flex min-w-0 items-center gap-2 text-[13px] leading-snug text-muted">
        <span className="rounded bg-navy/8 px-1.5 py-px text-[11px] font-semibold uppercase tracking-[0.08em] text-navy">Demo</span>
        Time-skip: plays the scheduled check-backs
      </p>
      <div className="flex items-center gap-3">
        {result && (
          <p
            role={result.ok ? "status" : "alert"}
            className={`flex items-center gap-1.5 text-[12.5px] font-medium ${result.ok ? "text-leaf" : "text-brick"}`}
          >
            {!result.ok && <CircleAlert aria-hidden size={14} />}
            {result.text}
          </p>
        )}
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || scheduled === 0}
          title={scheduled === 0 ? "No follow-ups are scheduled" : undefined}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-navy/25 bg-sheet px-2.5 text-[13px] font-semibold text-navy transition-colors hover:border-sky hover:bg-sky-wash disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <LoaderCircle aria-hidden size={14} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <FastForward aria-hidden size={14} strokeWidth={2.25} />
          )}
          Run due follow-ups now
        </button>
      </div>
    </div>
  );
}
