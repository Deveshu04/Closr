"use client";

import { Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import type { ProfileKind } from "@/lib/types";
import { ClosrMark } from "../brand/ClosrMark";
import type { CallPhase } from "../hooks/useCallRequest";
import { duration } from "../lib/format";
import { displayIndianMobile } from "../lib/phone";
import type { Step, Tone } from "./story";

export const BUBBLE: Record<Tone, string> = {
  progress: "bg-sky-wash text-sky",
  done: "bg-sky-wash text-navy",
  waiting: "live-dot bg-amber-wash text-amber",
  problem: "bg-brick-wash text-brick",
  handoff: "bg-navy text-white",
};

interface Props {
  app: ProfileKind;
  phase: CallPhase;
  elapsed: number | null;
  /** The number being called, as +91XXXXXXXXXX, when known. */
  phone: string | null;
  steps: Step[];
}

export function LiveCall({ app, phase, elapsed, phone, steps }: Props) {
  const connected = phase === "in_progress";
  const reduceMotion = useReducedMotion();
  const last = useRef<HTMLLIElement>(null);
  const lastKey = steps.length ? `${steps.length}:${steps.at(-1)?.id}:${steps.at(-1)?.tone}` : "";

  useEffect(() => {
    if (lastKey) last.current?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [lastKey, reduceMotion]);

  return (
    <div className="space-y-4 p-4">
      <section aria-label="Your call" className="rounded-2xl bg-navy px-5 py-5 text-white shadow-[0_18px_36px_-20px_rgb(0_46_110/0.9)]">
        <div className="flex items-center gap-4">
          <span className="call-halo grid size-14 shrink-0 place-items-center rounded-full bg-white/10 ring-1 ring-white/20">
            <ClosrMark className="size-8" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold leading-tight">Closr · AI assistant</p>
            <p className="truncate text-[13px] text-white/65">
              {app === "merchant" ? "Paytm for Business support" : "Paytm 24x7 Help"}
            </p>
            <p aria-live="polite" className="mt-1.5 flex items-center gap-2 text-sm font-medium text-sky">
              <span aria-hidden className="live-dot size-2 rounded-full bg-sky" />
              {connected ? "On call" : "Calling you…"}
            </p>
          </div>
          <p className="figures text-[1.75rem] font-semibold leading-none tracking-tight" aria-label="Call time">
            {duration(elapsed ?? 0)}
          </p>
        </div>
        {!connected && (
          <p className="mt-4 border-t border-white/10 pt-3 text-sm leading-snug text-white/75">
            {phone ? `Pick up the call on ${displayIndianMobile(phone)}.` : "Pick up when your phone rings."} It&apos;s
            Closr, from {app === "merchant" ? "Paytm for Business support" : "Paytm 24x7 Help"}.
          </p>
        )}
      </section>

      <section aria-labelledby="live-feed-heading" className="card px-4 pb-2 pt-4">
        <h2 id="live-feed-heading" className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
          Live updates
        </h2>
        {steps.length === 0 ? (
          <div className="pb-3 pt-6 text-center">
            <p className="text-sm leading-relaxed text-muted">
              {connected
                ? "Tell Closr what's wrong. Each step it takes shows up here."
                : "Once you pick up, each step shows up here: what Closr understood, what it checked and what it fixed."}
            </p>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-faint">
              <ShieldCheck aria-hidden size={13} />
              Closr acts only within Paytm policy, and checks every change.
            </p>
          </div>
        ) : (
          <ol aria-live="polite" aria-relevant="additions" className="mt-2">
            <AnimatePresence initial={false}>
              {steps.map((step, i) => (
                <motion.li
                  key={step.id}
                  ref={i === steps.length - 1 ? last : undefined}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  {step.minor ? <Confirmation step={step} /> : <StepRow step={step} />}
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </section>
    </div>
  );
}

function StepRow({ step }: { step: Step }) {
  const Icon = step.icon;
  return (
    <div className={`flex items-start gap-3 py-2.5 ${step.tone === "handoff" ? "my-1 rounded-xl bg-sky-wash px-3" : ""}`}>
      <span className={`relative grid size-9 shrink-0 place-items-center rounded-full ${BUBBLE[step.tone]}`}>
        {step.tone === "progress" ? (
          <LoaderCircle aria-hidden size={17} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Icon aria-hidden size={17} strokeWidth={2.25} />
        )}
      </span>
      <div className="min-w-0 flex-1 pt-1.5">
        <p className={`text-[15px] font-semibold leading-snug ${step.tone === "problem" ? "text-brick" : "text-ink"}`}>
          {step.text}
        </p>
        {step.detail && <p className="figures mt-0.5 text-[13px] leading-snug text-muted">{step.detail}</p>}
      </div>
    </div>
  );
}

/** A small confirmation tucked under the step it confirms. */
function Confirmation({ step }: { step: Step }) {
  const Icon = step.icon;
  const mark =
    step.tone === "progress" ? (
      <LoaderCircle aria-hidden size={14} className="animate-spin motion-reduce:animate-none" />
    ) : step.tone === "problem" ? (
      <Icon aria-hidden size={14} />
    ) : (
      <span className="grid size-4 place-items-center rounded-full bg-leaf">
        <Check aria-hidden size={11} strokeWidth={3.5} className="text-white" />
      </span>
    );
  const tone = step.tone === "problem" ? "text-brick" : step.tone === "progress" ? "text-muted" : "text-leaf";
  return (
    <p className={`-mt-1 flex items-center gap-1.5 pb-2.5 pl-12 text-[13px] font-medium ${tone}`}>
      {mark}
      {step.text}
    </p>
  );
}
