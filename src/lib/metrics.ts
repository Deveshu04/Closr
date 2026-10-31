import { getState, listCalls, momentsByCall } from "@/lib/db";
import type { CallRecord, Moment, OutcomeMetrics } from "@/lib/types";

/** A call that never connected, or a chat that never opened, isn't a conversation. */
const REACHED: ReadonlySet<CallRecord["status"]> = new Set(["in_progress", "completed"]);

function idsChanged(moments: Moment[]): string[] {
  return moments
    .filter((moment) => moment.kind === "action" && moment.status === "ok")
    .flatMap((moment) => [
      ...(moment.touched ?? []),
      ...[moment.data?.payoutId, moment.data?.disputeId].filter((id): id is string => typeof id === "string"),
    ]);
}

/** Outcomes across every call and chat on record, read fresh from the store. */
export function computeMetrics(): OutcomeMetrics {
  const state = getState();
  const conversations = listCalls().filter((call) => REACHED.has(call.status));
  const approvalCalls = new Set(state.approvals.map((approval) => approval.callRef));

  let verifiedResolutions = 0;
  let resolvedAutonomously = 0;
  let escalations = 0;
  const resolutionSecs: number[] = [];
  // Seeded history already holds payouts and disputes; only records a conversation's own actions changed count.
  const changedByClosr = new Set<string>();

  const allMoments = momentsByCall();
  for (const call of conversations) {
    const moments = allMoments.get(call.callRef) ?? [];
    for (const id of idsChanged(moments)) changedByClosr.add(id);

    const escalated = moments.some((moment) => moment.kind === "escalated");
    if (escalated) escalations += 1;

    // A confirmed offer is a sale, not a resolution of the customer's issue.
    const verified = moments
      .filter((moment) => moment.kind === "verified" && moment.status === "ok" && moment.system !== "sales")
      .map((moment) => Date.parse(moment.at))
      .filter(Number.isFinite);
    if (verified.length === 0) continue;
    verifiedResolutions += 1;

    const neededApproval = approvalCalls.has(call.callRef) || moments.some((moment) => moment.kind === "approval");
    if (!escalated && !neededApproval) resolvedAutonomously += 1;

    const seconds = (Math.min(...verified) - Date.parse(call.startedAt)) / 1000;
    if (Number.isFinite(seconds) && seconds >= 0) resolutionSecs.push(seconds);
  }

  const moneyReturned = state.payouts
    .filter((payout) => payout.status === "processed" && changedByClosr.has(payout.id))
    .reduce((sum, payout) => sum + payout.amount, 0);
  // Counted whatever their status now: a dispute a follow-up has since resolved was still raised.
  const disputesRaised = state.disputes.filter((dispute) => changedByClosr.has(dispute.id)).length;

  return {
    conversations: conversations.length,
    resolvedAutonomously,
    verifiedResolutions,
    escalations,
    approvals: {
      requested: state.approvals.length,
      approved: state.approvals.filter((approval) => approval.status === "approved").length,
      denied: state.approvals.filter((approval) => approval.status === "denied").length,
    },
    moneyReturned,
    disputesRaised,
    avgResolutionSec: resolutionSecs.length
      ? Math.round(resolutionSecs.reduce((sum, seconds) => sum + seconds, 0) / resolutionSecs.length)
      : null,
    autonomousRate: conversations.length ? resolvedAutonomously / conversations.length : null,
  };
}
