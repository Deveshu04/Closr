"use client";

import { Stamp } from "lucide-react";
import { motion } from "motion/react";
import type { Moment } from "@/lib/types";
import { inr } from "../lib/format";
import { keyFields, pickNumber, pickString } from "../lib/data";
import { systemOf } from "../lib/systems";
import { FieldGrid, StatusNote, isTrouble } from "./shared";

const ID_KEYS = ["recordId", "refundId", "ticketId", "invoiceId", "id", "ref"];
const AMOUNT_KEYS = ["amount", "refundAmount", "total"];

function recordIdOf(moment: Moment): string | undefined {
  return (
    pickString(moment.data, ...ID_KEYS) ??
    moment.touched?.find((id) => /^[A-Z]{2,}-/.test(id)) ??
    moment.touched?.[0]
  );
}

/** Something the agent did. A solid slab with the new record id stamped onto it. */
export function ActionMoment({ moment }: { moment: Moment }) {
  const system = systemOf(moment.system);
  const Icon = system?.icon ?? Stamp;
  const recordId = recordIdOf(moment);
  const amount = pickNumber(moment.data, ...AMOUNT_KEYS);
  const fields = keyFields(moment.data, [...ID_KEYS, ...AMOUNT_KEYS, "orderId"], 4);
  const orderId = pickString(moment.data, "orderId");

  if (isTrouble(moment.status)) {
    return (
      <article className="rounded-lg border-2 border-brick/40 bg-brick-wash px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-semibold leading-tight text-brick">{moment.title}</h3>
          <StatusNote status={moment.status} className="pt-1" />
        </div>
        {moment.detail && <p className="mt-1 text-[15px] text-ink/80">{moment.detail}</p>}
      </article>
    );
  }

  const running = moment.status === "running";

  return (
    <article
      className={`rounded-lg bg-navy px-5 py-4 text-white shadow-[0_14px_32px_-16px_rgb(0_33_79/0.7)] ${running ? "is-running" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-sky">
            <Icon aria-hidden size={14} strokeWidth={2.25} />
            {system?.label ?? "Action"}
            {orderId && <span className="font-medium text-white/60">for {orderId}</span>}
          </p>
          <h3 className="mt-1 text-[1.375rem] font-semibold leading-tight">{moment.title}</h3>
          {moment.detail && <p className="mt-1 text-[15px] leading-snug text-white/75">{moment.detail}</p>}
        </div>
        {amount !== undefined && (
          <p className="figures font-serif text-[2.5rem] font-semibold leading-none [font-variation-settings:'opsz'_60]">
            {inr(amount)}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          {running ? (
            <StatusNote status="running" className="text-sky" />
          ) : (
            <FieldGrid fields={fields} tone="dark" className="" />
          )}
        </div>
        {recordId && !running && (
          <motion.div
            key={recordId}
            initial={{ opacity: 0, scale: 1.9, rotate: -16 }}
            animate={{ opacity: 1, scale: 1, rotate: -4 }}
            transition={{ type: "spring", stiffness: 520, damping: 17, delay: 0.15 }}
            className="stamp-face shrink-0 rounded-md border-[3px] border-sky px-3 py-1 text-[1.625rem] font-bold uppercase leading-tight text-sky shadow-[inset_0_0_0_2px_var(--color-navy),inset_0_0_0_3.5px_var(--color-sky)]"
          >
            {recordId}
          </motion.div>
        )}
      </div>
    </article>
  );
}
