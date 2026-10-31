"use client";

import { useCallback, useState } from "react";
import type { Approval, Moment } from "@/lib/types";
import { decideApproval } from "../lib/api";
import { pickString } from "../lib/data";

export type Decision = "approved" | "denied";

export interface DecisionState {
  decision: Decision;
  phase: "sending" | "sent" | "error";
  error?: string;
}

export interface ApprovalControls {
  approvals: Approval[];
  decisions: Record<string, DecisionState>;
  decide: (id: string, decision: Decision) => void;
}

/** Server status wins once decided; until then a decision in flight is shown optimistically. */
export function effectiveStatus(approval: Approval, local: DecisionState | undefined): Approval["status"] {
  if (approval.status !== "pending") return approval.status;
  if (local && local.phase !== "error") return local.decision;
  return "pending";
}

export function approvalForMoment(moment: Moment, approvals: Approval[]): Approval | undefined {
  const id =
    pickString(moment.data, "approvalId", "approval_id") ??
    moment.touched?.find((t) => approvals.some((a) => a.id === t));
  if (id) {
    const exact = approvals.find((a) => a.id === id);
    if (exact) return exact;
  }
  const forCall = approvals.filter((a) => a.callRef === moment.callRef);
  return forCall.find((a) => a.status === "pending") ?? forCall.at(-1);
}

export function useApprovals(approvals: Approval[], refresh: () => void): ApprovalControls {
  const [decisions, setDecisions] = useState<Record<string, DecisionState>>({});

  const decide = useCallback(
    (id: string, decision: Decision) => {
      setDecisions((prev) => ({ ...prev, [id]: { decision, phase: "sending" } }));
      void decideApproval(id, decision).then((result) => {
        setDecisions((prev) => ({
          ...prev,
          [id]: result.ok ? { decision, phase: "sent" } : { decision, phase: "error", error: result.error },
        }));
        refresh();
      });
    },
    [refresh],
  );

  return { approvals, decisions, decide };
}
