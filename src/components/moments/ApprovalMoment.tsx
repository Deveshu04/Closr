import { Hand } from "lucide-react";
import type { Moment } from "@/lib/types";
import { ApprovalButtons } from "../ApprovalButtons";
import { type ApprovalControls, approvalForMoment, effectiveStatus } from "../hooks/useApprovals";
import { inr } from "../lib/format";
import { pickNumber, pickString } from "../lib/data";
import { StatusNote } from "./shared";

/** Over the agent's limit: the brief, the amount, and the human's one-tap decision. */
export function ApprovalMoment({ moment, controls }: { moment: Moment; controls: ApprovalControls }) {
  const approval = approvalForMoment(moment, controls.approvals);
  const status = approval ? effectiveStatus(approval, controls.decisions[approval.id]) : undefined;
  const waiting = approval ? status === "pending" : moment.status === "waiting";
  const amount = approval?.amount ?? pickNumber(moment.data, "amount");
  const brief = approval?.brief ?? pickString(moment.data, "brief") ?? moment.detail;
  const reason = approval?.reason ?? pickString(moment.data, "reason");
  const orderId = approval?.orderId ?? pickString(moment.data, "orderId");

  return (
    <article
      className={`rounded-lg border-2 px-5 py-4 ${
        waiting ? "is-waiting border-amber-bright bg-amber-wash" : "border-amber-bright/45 bg-amber-wash/60"
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber">
            <Hand aria-hidden size={14} strokeWidth={2.25} />
            {waiting ? "Needs your approval" : "Approval"}
            {orderId && <span className="font-medium text-muted">for {orderId}</span>}
          </p>
          <h3 className="mt-1 text-[1.25rem] font-semibold leading-tight text-ink">{moment.title}</h3>
        </div>
        {amount !== undefined && (
          <p className="figures font-serif text-[2.25rem] font-semibold leading-none text-ink [font-variation-settings:'opsz'_60]">
            {inr(amount)}
          </p>
        )}
      </header>

      {brief && <p className="mt-2.5 max-w-[62ch] text-base leading-relaxed text-ink/90">{brief}</p>}
      {reason && reason !== brief && <p className="mt-1 text-sm text-muted">{reason}</p>}

      <div className="mt-4">
        {approval ? (
          <ApprovalButtons approval={approval} controls={controls} />
        ) : (
          <StatusNote status={moment.status} />
        )}
      </div>
    </article>
  );
}
