"use client";

import { Check, CircleCheck, CircleX, LoaderCircle, X } from "lucide-react";
import type { Approval } from "@/lib/types";
import { clockTime } from "./lib/format";
import { type ApprovalControls, effectiveStatus } from "./hooks/useApprovals";

interface Props {
  approval: Approval;
  controls: ApprovalControls;
  size?: "lg" | "md";
}

/** Approve / Deny for one approval, and the decided state once a human has answered. */
export function ApprovalButtons({ approval, controls, size = "lg" }: Props) {
  const local = controls.decisions[approval.id];
  const status = effectiveStatus(approval, local);
  const sending = local?.phase === "sending" && approval.status === "pending";
  const height = size === "lg" ? "h-14 text-lg" : "h-11 text-base";

  if (status !== "pending") {
    const approved = status === "approved";
    return (
      <p
        className={`flex items-center gap-2 text-[17px] font-semibold ${approved ? "text-leaf" : "text-brick"}`}
        aria-live="polite"
      >
        {sending ? (
          <LoaderCircle aria-hidden size={20} className="animate-spin text-muted motion-reduce:animate-none" />
        ) : approved ? (
          <CircleCheck aria-hidden size={20} />
        ) : (
          <CircleX aria-hidden size={20} />
        )}
        {sending
          ? `Sending: ${approved ? "approve" : "deny"}`
          : approved
            ? "Approved"
            : "Denied"}
        {!sending && approval.decidedAt && (
          <span className="figures text-sm font-normal text-muted">at {clockTime(approval.decidedAt)}</span>
        )}
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => controls.decide(approval.id, "approved")}
          className={`${height} inline-flex items-center justify-center gap-2 rounded-md bg-navy font-semibold text-white transition-colors hover:bg-navy-deep active:translate-y-px`}
        >
          <Check aria-hidden size={20} strokeWidth={2.75} />
          Approve
        </button>
        <button
          type="button"
          onClick={() => controls.decide(approval.id, "denied")}
          className={`${height} inline-flex items-center justify-center gap-2 rounded-md border-2 border-brick/50 bg-sheet font-semibold text-brick transition-colors hover:bg-brick-wash active:translate-y-px`}
        >
          <X aria-hidden size={20} strokeWidth={2.75} />
          Deny
        </button>
      </div>
      {local?.phase === "error" && (
        <p role="alert" className="mt-2 text-sm font-medium text-brick">
          {local.error ?? "The decision didn't go through."} Try again.
        </p>
      )}
    </div>
  );
}
