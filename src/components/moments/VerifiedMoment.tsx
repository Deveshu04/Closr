"use client";

import { Check, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import type { Moment } from "@/lib/types";
import { keyFields } from "../lib/data";
import { systemOf } from "../lib/systems";
import { FieldGrid, StatusNote, isTrouble } from "./shared";

const SEAL_POINTS = (() => {
  const teeth = 18;
  const pts: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? 30 : 26.5;
    const a = (Math.PI * i) / teeth - Math.PI / 2;
    pts.push(`${(32 + r * Math.cos(a)).toFixed(2)},${(32 + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
})();

function Seal({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className="size-full" aria-hidden>
      <polygon points={SEAL_POINTS} className={muted ? "fill-faint" : "fill-leaf"} />
      <circle cx="32" cy="32" r="20" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="1.5" />
    </svg>
  );
}

/** The result re-read from the system of record, sealed. */
export function VerifiedMoment({ moment }: { moment: Moment }) {
  const system = systemOf(moment.system);
  const trouble = isTrouble(moment.status);
  const running = moment.status === "running";
  const fields = keyFields(moment.data, [], 6);

  return (
    <article
      className={`flex items-start gap-4 rounded-lg border px-4 py-3.5 ${
        trouble ? "border-brick/40 bg-brick-wash" : "border-leaf/25 bg-leaf-wash"
      } ${running ? "is-running" : ""}`}
    >
      <motion.span
        initial={{ opacity: 0, scale: 0.5, rotate: -120 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="relative grid size-14 shrink-0 place-items-center"
      >
        <Seal muted={trouble || running} />
        <Check aria-hidden size={24} strokeWidth={3} className="absolute text-white" />
      </motion.span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className={`text-[17px] font-semibold leading-snug ${trouble ? "text-brick" : "text-leaf"}`}>
            {moment.title}
          </h3>
          <StatusNote status={moment.status} className="pt-0.5" />
        </div>
        {system && (
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink/70">
            <RotateCcw aria-hidden size={13} />
            Re-read from {system.label}
          </p>
        )}
        {moment.detail && <p className="mt-1 text-[15px] leading-snug text-ink/85">{moment.detail}</p>}
        <FieldGrid fields={fields} className="mt-2.5" />
      </div>
    </article>
  );
}
