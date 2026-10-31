import * as db from "@/lib/db";
import {
  addBusinessDays,
  addHours,
  atIst,
  calendarDaysBetween,
  formatDateTime,
  formatLongDate,
  formatPhone,
  formatRupees,
  formatShortDate,
  hoursSince,
  istDateKey,
  lastDigits,
  spokenId,
  spokenRupees,
  truncate,
} from "@/lib/format";
import { randomDigits, voiceSafeId } from "@/lib/ids";
import {
  DELIVERY_SLOTS,
  ESCALATION_CALLBACK_HOURS,
  QC_SLA_HOURS,
  RESCHEDULE_WINDOW_DAYS,
  RETURN_PICKUP_SCAN,
  evaluateAddressChange,
  evaluateRefund,
  evaluateReschedule,
  humanStatus,
  refundMethodFor,
  refundSettlementBusinessDays,
} from "@/lib/policy";
import { checkClaim, searchWeb, type ClaimVerdict } from "@/lib/search";
import { parseDeliveryDate, parseSlot, readPincode, readText, type ToolParams } from "@/lib/tool-input";
import type {
  Address,
  Approval,
  CallRecord,
  Customer,
  MomentKind,
  MomentStatus,
  Order,
  PolicyDecision,
  Refund,
  SystemName,
  Ticket,
} from "@/lib/types";

export interface ToolResult {
  ok: boolean;
  /** One or two plain sentences the voice agent can paraphrase to the caller. */
  say: string;
  [field: string]: unknown;
}

type ToolHandler = (params: ToolParams, call: CallRecord) => Promise<ToolResult>;

function readMs(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const APPROVAL_WAIT_MS = readMs("APPROVAL_WAIT_MS", 20_000);
const APPROVAL_POLL_MS = 500;
const STEP_PACE_MS = readMs("MOMENT_PACE_MS", 250);
const UNIDENTIFIED_CUSTOMER = "unidentified";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------- Console steps ----------

interface StepStart {
  kind: MomentKind;
  system?: SystemName;
  title: string;
  detail?: string;
  data?: Record<string, unknown>;
}

/** Records a running step, then pauses briefly so the polling console can show it before it resolves. */
async function startStep(callRef: string, step: StepStart): Promise<string> {
  const moment = db.recordMoment({ ...step, callRef, status: "running" });
  if (STEP_PACE_MS > 0) await sleep(STEP_PACE_MS);
  return moment.id;
}

interface Verification {
  passed: boolean;
  title: string;
  detail: string;
  touched?: string[];
}

/** Every action is followed by a fresh read from the system it changed, shown as its own step. */
async function verifyStep(
  callRef: string,
  system: SystemName,
  title: string,
  check: () => Verification,
): Promise<boolean> {
  const momentId = await startStep(callRef, { kind: "verified", system, title });
  const result = check();
  db.updateMoment(momentId, {
    status: result.passed ? "ok" : "failed",
    title: result.title,
    detail: result.detail,
    touched: result.touched,
  });
  return result.passed;
}

function recordUnderstanding(params: ToolParams, call: CallRecord): boolean {
  const intent = readText(params, "intent");
  if (!intent) return false;
  const sentiment = readText(params, "sentiment");
  const language = readText(params, "language");
  const detail = [sentiment && `Sentiment: ${sentiment}`, language && `Language: ${language}`]
    .filter(Boolean)
    .join(" · ");
  db.recordMoment({
    callRef: call.callRef,
    kind: "understood",
    status: "ok",
    title: intent,
    detail: detail || undefined,
    data: { intent, sentiment, language },
  });
  return true;
}

// ---------- Calls and orders ----------

// Bolna doesn't send call_ref, and calls started outside our dialer (Bolna's playground, curl)
// still deserve a console timeline, so a fresh call is opened when none is live.
function callForTool(params: ToolParams): CallRecord {
  const ref = readText(params, "call_ref");
  const named = ref ? (db.getCall(ref) ?? db.findCallByExecutionId(ref)) : null;
  if (named) return named;

  const active = db.getActiveCall();
  if (active && active.status !== "completed" && active.status !== "failed") return active;

  const call = db.createCall(readText(params, "phone") ?? "");
  return db.updateCall(call.callRef, { status: "in_progress" }) ?? call;
}

function itemSummary(order: Order): string {
  const [first, ...rest] = order.items;
  return rest.length > 0 ? `${first.name} + ${rest.length} more` : first.name;
}

function oneLineAddress(address: Address): string {
  return [address.line1, address.line2, `${address.city} ${address.pincode}`].filter(Boolean).join(", ");
}

/** Accepts "NB-24117", "24117", "nb 24117", the last few digits, or a product word like "headphones". */
function findOrder(reference: string, customerId: string | undefined): Order | null {
  const exact = db.getOrder(reference.toUpperCase().replace(/\s+/g, "-"));
  if (exact) return exact;

  const orders = db.listOrders();
  const digits = reference.replace(/\D/g, "");
  if (digits.length >= 5) {
    const byNumber = orders.find((order) => order.id.replace(/\D/g, "") === digits);
    if (byNumber) return byNumber;
  }
  if (!customerId) return null;

  const own = orders.filter((order) => order.customerId === customerId);
  if (digits.length >= 3) {
    const byTail = own.find((order) => order.id.endsWith(digits));
    if (byTail) return byTail;
  }
  const words = reference
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 3)
    .map((word) => word.replace(/s$/, ""));
  return (
    own.find((order) => order.items.some((item) => words.some((word) => item.name.toLowerCase().includes(word)))) ??
    null
  );
}

type Located = { found: true; order: Order } | { found: false; result: ToolResult };

function locateOrder(params: ToolParams, call: CallRecord, step: { kind: MomentKind; system: SystemName }): Located {
  const reference = readText(params, "order_id");
  const order = reference ? findOrder(reference, call.customerId) : null;
  // Another customer's order is reported as not found, so a caller can't probe other accounts.
  if (order && call.customerId && order.customerId === call.customerId) return { found: true, order };

  const known = call.customerId ? db.listOrders(call.customerId).slice(0, 4) : [];
  db.recordMoment({
    callRef: call.callRef,
    ...step,
    status: "failed",
    title: reference ? `Order "${reference}" not found` : "No order id given",
    detail: known.length > 0 ? `Caller's orders: ${known.map((candidate) => candidate.id).join(", ")}` : undefined,
  });
  const hint =
    known.length > 0
      ? ` Recent orders on this account: ${known
          .map((candidate) => `${itemSummary(candidate)}, ${spokenId(candidate.id)}`)
          .join("; ")}.`
      : " Could you read out the order ID?";
  return {
    found: false,
    result: {
      ok: false,
      known_orders: known.map((candidate) => ({ order_id: candidate.id, item: itemSummary(candidate) })),
      say: `${reference ? `I couldn't find order ${spokenId(reference)} on this account.` : "I need the order ID."}${hint}`,
    },
  };
}

function relativeDay(iso: string, now: Date): string {
  const days = calendarDaysBetween(iso, now);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function statusLabel(order: Order, refund: Refund | null): string {
  if (refund) {
    const labels: Record<Refund["status"], string> = {
      processed: "refunded",
      pending_approval: "refund awaiting approval",
      rejected: "refund declined",
    };
    return labels[refund.status];
  }
  switch (order.status) {
    case "placed":
      return "packed, not shipped yet";
    case "shipped":
      return order.shipment.eta ? `in transit, arriving ${formatShortDate(order.shipment.eta)}` : "in transit";
    case "out_for_delivery":
      return "out for delivery today";
    case "delivered":
      return `delivered ${formatShortDate(order.deliveredAt ?? order.placedAt)}`;
    case "return_requested":
      return "return pickup scheduled";
    case "return_picked":
      return "return picked up, refund pending";
    case "refunded":
      return "refunded";
    case "cancelled":
      return "cancelled";
  }
}

/** The one line a support lead would want before picking up the phone. */
function diagnose(order: Order, refund: Refund | null, now: Date = new Date()): string {
  if (refund?.status === "processed") {
    return `Refunded ${formatRupees(refund.amount)} on ${formatShortDate(refund.createdAt)}${refund.utr ? `, UTR ${refund.utr}` : ""}`;
  }
  if (refund?.status === "pending_approval") return `Refund of ${formatRupees(refund.amount)} waiting for team approval`;
  if (refund?.status === "rejected") return "Refund was reviewed and declined";

  const returned = order.return;
  if (returned) {
    if (!returned.pickedAt) {
      return `Return raised ${relativeDay(returned.requestedAt, now)}; courier pickup still pending`;
    }
    if (returned.qcStatus === "passed") {
      return `QC passed ${relativeDay(returned.qcSince ?? returned.pickedAt, now)}; refund never initiated`;
    }
    if (returned.qcStatus === "failed") return "Return failed QC; not eligible for a refund";
    const since = returned.qcSince ?? returned.pickedAt;
    return hoursSince(since, now) > QC_SLA_HOURS
      ? `QC stuck ${calendarDaysBetween(since, now)} days, beyond ${QC_SLA_HOURS}h SLA; refund never initiated`
      : `Return at warehouse; QC due by ${formatDateTime(addHours(since, QC_SLA_HOURS))}`;
  }

  const { courier, eta, slot } = order.shipment;
  const slotText = slot ? `, ${slot}` : "";
  switch (order.status) {
    case "placed":
      return "Packed at the warehouse; waiting for courier pickup";
    case "shipped":
      return `In transit with ${courier}${eta ? `; arriving ${formatLongDate(eta)}${slotText}` : ""}`;
    case "out_for_delivery":
      return `Out for delivery with ${courier} today${slotText}`;
    case "delivered":
      return `Delivered ${formatShortDate(order.deliveredAt ?? order.placedAt)}`;
    case "return_requested":
      return "Return requested; courier pickup still pending";
    case "return_picked":
      return "Return picked up";
    case "refunded":
      return "Refunded";
    case "cancelled":
      return "Cancelled";
  }
}

function orderBrief(order: Order) {
  const { shipment, address } = order;
  const inFlight = !order.deliveredAt;
  return {
    order_id: order.id,
    items: order.items.map((item) => (item.qty > 1 ? `${item.qty} x ${item.name}` : item.name)).join(", "),
    amount: order.total,
    status: humanStatus(order.status),
    placed_on: formatShortDate(order.placedAt),
    delivered_on: order.deliveredAt ? formatShortDate(order.deliveredAt) : undefined,
    payment: order.payment.method,
    courier: shipment.courier,
    awb: shipment.awb,
    arriving: inFlight && shipment.eta ? formatLongDate(shipment.eta) : undefined,
    slot: inFlight ? shipment.slot : undefined,
    deliver_to: `${address.line1}, ${address.city} ${address.pincode}`,
    return: order.return
      ? {
          reason: order.return.reason,
          picked_up_on: order.return.pickedAt ? formatShortDate(order.return.pickedAt) : undefined,
          qc: order.return.qcStatus,
        }
      : undefined,
  };
}

// ---------- Helpdesk ----------

interface TicketChange {
  subject: string;
  status: Ticket["status"];
  priority?: Ticket["priority"];
  note: string;
}

/** Reuses the customer's ticket for the same order if it's still open or was touched during this call. */
function upsertCallTicket(
  callRef: string,
  target: { customerId: string; orderId?: string },
  change: TicketChange,
): { ticket: Ticket; created: boolean } {
  const call = db.getCall(callRef);
  const existing = db
    .listTickets(target.customerId)
    .find(
      (ticket) =>
        ticket.orderId === target.orderId &&
        (ticket.status !== "resolved" || (call !== null && ticket.updatedAt >= call.startedAt)),
    );
  if (existing) {
    const ticket = db.updateTicket(existing.id, {
      status: change.status,
      priority: change.priority ?? existing.priority,
      notes: [...existing.notes, change.note],
    });
    if (ticket) return { ticket, created: false };
  }
  const ticket = db.createTicket({
    customerId: target.customerId,
    orderId: target.orderId,
    subject: change.subject,
    status: change.status,
    priority: change.priority ?? "normal",
    notes: [change.note],
  });
  return { ticket, created: true };
}

function logTicket(callRef: string, order: Order, change: TicketChange): Ticket {
  const { ticket, created } = upsertCallTicket(callRef, { customerId: order.customerId, orderId: order.id }, change);
  db.recordMoment({
    callRef,
    kind: "action",
    system: "helpdesk",
    status: "ok",
    title: ticket.status === "resolved" ? `Ticket ${ticket.id} resolved` : `Ticket ${ticket.id} ${created ? "opened" : "updated"}`,
    detail: change.note,
    touched: [ticket.id],
    data: { ticketId: ticket.id, status: ticket.status },
  });
  return ticket;
}

// ---------- Refunds ----------

function evaluateRefundFor(order: Order): { decision: PolicyDecision; customer: Customer } {
  const customer = db.getCustomer(order.customerId);
  if (!customer) throw new Error(`Order ${order.id} has no customer record`);
  return { decision: evaluateRefund(order, customer, db.listRefunds(customer.id)), customer };
}

function policyMoment(order: Order, decision: PolicyDecision) {
  const passed = decision.checks.filter((check) => check.passed).length;
  const score = `${passed}/${decision.checks.length} checks passed`;
  const headline = {
    allow: "Refund allowed",
    needs_approval: "Needs one-tap approval",
    deny: "Refund blocked",
  }[decision.outcome];
  const status: MomentStatus = decision.outcome === "deny" ? "blocked" : "ok";
  return {
    status,
    title: `${headline} · ${score}`,
    detail: decision.reasons.join(" · "),
    touched: [order.id],
    data: {
      orderId: order.id,
      amount: order.total,
      outcome: decision.outcome,
      checks: decision.checks,
      reasons: decision.reasons,
    },
  };
}

function policySay(order: Order, decision: PolicyDecision): string {
  switch (decision.outcome) {
    case "allow":
      return `Policy allows a full refund of ${spokenRupees(order.total)} for order ${spokenId(order.id)}. I can process it right now.`;
    case "needs_approval":
      return `A refund of ${spokenRupees(order.total)} needs a quick sign-off from my team. I can request it now; it usually takes a few seconds.`;
    case "deny":
      return `I can't refund this right now: ${decision.reasons.join("; ")}.`;
  }
}

/** issue_refund re-checks policy itself, but only shows the checklist if check_refund hasn't already. */
function ensurePolicyMoment(call: CallRecord, order: Order, decision: PolicyDecision): void {
  const shown = db
    .listMoments(call.callRef)
    .some(
      (moment) =>
        moment.kind === "policy" && moment.data?.orderId === order.id && moment.data?.outcome === decision.outcome,
    );
  if (!shown) db.recordMoment({ callRef: call.callRef, kind: "policy", system: "policy", ...policyMoment(order, decision) });
}

function refundDestination(order: Order): string {
  switch (order.payment.method) {
    case "UPI":
      return "your UPI account";
    case "Card":
      return "your card";
    case "NetBanking":
      return "your bank account";
    case "COD":
      return "your bank account on file";
  }
}

function settlementFor(order: Order): { utr: string; expectedBy: string } {
  return {
    utr: randomDigits(12),
    expectedBy: addBusinessDays(new Date(), refundSettlementBusinessDays(order)).toISOString(),
  };
}

function newRefund(order: Order, status: Refund["status"]): Refund {
  return {
    id: voiceSafeId("RFND"),
    orderId: order.id,
    amount: order.total,
    status,
    method: refundMethodFor(order),
    idempotencyKey: `refund:${order.id}`,
    createdAt: new Date().toISOString(),
    ...(status === "processed" ? settlementFor(order) : {}),
  };
}

function refundOutcome(order: Order, refund: Refund, duplicate = false): ToolResult {
  const base = { order_id: order.id, refund_id: refund.id, amount: refund.amount, duplicate };
  switch (refund.status) {
    case "processed": {
      const expectedBy = refund.expectedBy ? formatLongDate(refund.expectedBy) : undefined;
      const lead = duplicate ? "This refund was already processed, so nothing new was issued" : "Done";
      return {
        ok: true,
        status: "processed",
        ...base,
        utr_last4: refund.utr ? lastDigits(refund.utr) : undefined,
        expected_by: expectedBy,
        say:
          `${lead}: ${spokenRupees(refund.amount)} refunded to ${refundDestination(order)}, reference ${spokenId(refund.id)}` +
          `${refund.utr ? `, UTR ending ${lastDigits(refund.utr)}` : ""}.` +
          `${expectedBy ? ` It should reflect by ${expectedBy}.` : ""}`,
      };
    }
    case "pending_approval":
      return {
        ok: true,
        status: "pending",
        ...base,
        say: `I've raised the ${spokenRupees(refund.amount)} refund for approval. My team will confirm shortly, and you'll get an SMS and WhatsApp the moment it's processed.`,
      };
    case "rejected":
      return {
        ok: false,
        status: "denied",
        ...base,
        say: "My team reviewed this refund and couldn't approve it right now. I can have a senior teammate call you back with the details.",
      };
  }
}

// A voice tool can't receive a callback, so the turn is held open while a person taps approve
// on the console. The approval route does the settling; this only watches for the outcome.
async function waitForSettlement(refundId: string): Promise<Refund> {
  const deadline = Date.now() + APPROVAL_WAIT_MS;
  let refund = db.getRefund(refundId);
  while (refund?.status === "pending_approval" && Date.now() < deadline) {
    await sleep(APPROVAL_POLL_MS);
    refund = db.getRefund(refundId);
  }
  if (!refund) throw new Error(`Refund ${refundId} disappeared while awaiting approval`);
  return refund;
}

// Voice agents re-fire a tool when a turn is repeated or interrupted. Answering with the refund
// already on record turns that into a no-op instead of a second payout.
async function replayRefund(call: CallRecord, order: Order, refund: Refund, momentId?: string): Promise<ToolResult> {
  const caught = {
    kind: "verified" as const,
    system: "payments" as const,
    status: "ok" as const,
    title: "Duplicate refund request caught",
    detail: `${refund.id} is already ${refund.status.replace(/_/g, " ")}; no second refund issued`,
    touched: [refund.id],
    data: { refundId: refund.id, orderId: order.id, duplicate: true },
  };
  if (momentId) db.updateMoment(momentId, caught);
  else db.recordMoment({ callRef: call.callRef, ...caught });

  const current = refund.status === "pending_approval" ? await waitForSettlement(refund.id) : refund;
  return refundOutcome(order, current, true);
}

async function verifyRefund(callRef: string, refundId: string, order: Order): Promise<boolean> {
  return verifyStep(callRef, "payments", "Re-reading the payments ledger", () => {
    const stored = db.getRefund(refundId);
    if (stored?.status === "processed" && stored.amount === order.total && stored.utr) {
      return {
        passed: true,
        title: "Refund verified in payments",
        detail: `${stored.id} · ${formatRupees(stored.amount)} · processed · UTR ${stored.utr}`,
        touched: [stored.id],
      };
    }
    return {
      passed: false,
      title: "Payments ledger doesn't confirm the refund",
      detail: stored ? `${stored.id} shows ${stored.status}` : `${refundId} is missing from the ledger`,
    };
  });
}

async function completeRefund(callRef: string, order: Order, refund: Refund, momentId: string): Promise<boolean> {
  db.updateOrder(order.id, { status: "refunded" });
  db.updateMoment(momentId, {
    status: "ok",
    title: `Refund ${refund.id} issued`,
    detail: `${formatRupees(refund.amount)} to ${refund.method} · UTR ${refund.utr} · by ${refund.expectedBy ? formatShortDate(refund.expectedBy) : "—"}`,
    touched: [refund.id, order.id],
    data: { refundId: refund.id, amount: refund.amount, utr: refund.utr, expectedBy: refund.expectedBy },
  });
  logTicket(callRef, order, {
    subject: `Refund for ${itemSummary(order)}`,
    status: "resolved",
    note: `Refund ${refund.id} of ${formatRupees(refund.amount)} processed to ${refund.method}, UTR ${refund.utr}, expected by ${refund.expectedBy ? formatShortDate(refund.expectedBy) : "—"}.`,
  });
  return verifyRefund(callRef, refund.id, order);
}

async function refundNow(call: CallRecord, order: Order, reason: string): Promise<ToolResult> {
  const momentId = await startStep(call.callRef, {
    kind: "action",
    system: "payments",
    title: `Issuing ${formatRupees(order.total)} refund`,
    detail: `To ${refundMethodFor(order)} · ${reason}`,
  });
  const { refund, created } = db.insertRefundOnce(newRefund(order, "processed"));
  if (!created) return replayRefund(call, order, refund, momentId);

  const verified = await completeRefund(call.callRef, order, refund, momentId);
  return { ...refundOutcome(order, refund), verified };
}

function approvalBrief(order: Order, customer: Customer, decision: PolicyDecision): string {
  const scan = order.shipment.events.find((event) => event.status === RETURN_PICKUP_SCAN);
  const standing = customer.flags.length > 0 ? `flagged ${customer.flags.join(", ")}` : "no flags";
  return [
    `${formatRupees(order.total)} refund · ${itemSummary(order)} (${order.id})`,
    scan ? `${order.shipment.courier} pickup verified ${formatShortDate(scan.at)}` : "No pickup scan",
    diagnose(order, null),
    `${customer.name}: ${customer.tier}, ${formatRupees(customer.lifetimeValue)} lifetime, ${standing}`,
    `Needs you because: ${decision.reasons.join("; ")}`,
  ].join(" · ");
}

async function requestApproval(
  call: CallRecord,
  order: Order,
  customer: Customer,
  decision: PolicyDecision,
  reason: string,
): Promise<ToolResult> {
  const { refund, created } = db.insertRefundOnce(newRefund(order, "pending_approval"));
  if (!created) return replayRefund(call, order, refund);

  const approval = db.createApproval({
    callRef: call.callRef,
    orderId: order.id,
    amount: order.total,
    reason,
    brief: approvalBrief(order, customer, decision),
  });
  db.recordMoment({
    callRef: call.callRef,
    kind: "approval",
    system: "payments",
    status: "waiting",
    title: `Waiting for one-tap approval · ${formatRupees(order.total)}`,
    detail: approval.brief,
    touched: [approval.id, refund.id],
    data: { approvalId: approval.id, refundId: refund.id, orderId: order.id, amount: order.total },
  });

  const settled = await waitForSettlement(refund.id);
  if (settled.status === "pending_approval") {
    logTicket(call.callRef, order, {
      subject: `Refund for ${itemSummary(order)}`,
      status: "open",
      note: `Refund ${refund.id} of ${formatRupees(refund.amount)} awaiting approval ${approval.id}; customer told the team will confirm.`,
    });
  }
  return refundOutcome(order, settled);
}

/** Records a person's decision and, on approval, settles the refund; the waiting tool call picks up the result. */
export async function resolveApproval(id: string, decision: "approved" | "denied"): Promise<Approval | null> {
  const before = db.getApproval(id);
  if (!before || before.status !== "pending") return before;
  const approval = db.decideApproval(id, decision);
  if (!approval) return null;

  const waiting = db
    .listMoments(approval.callRef)
    .find((moment) => moment.kind === "approval" && moment.data?.approvalId === approval.id);
  if (waiting) {
    const seconds = Math.max(1, Math.round((Date.now() - Date.parse(approval.createdAt)) / 1000));
    db.updateMoment(
      waiting.id,
      decision === "approved"
        ? { status: "ok", title: `Approved by the team in ${seconds}s · ${formatRupees(approval.amount)}` }
        : { status: "blocked", title: `Denied by the team · ${formatRupees(approval.amount)}` },
    );
  }

  const order = db.getOrder(approval.orderId);
  const refund = db.findRefundForOrder(approval.orderId);
  if (!order || refund?.status !== "pending_approval") return approval;

  if (decision === "denied") {
    db.settleRefund(refund.id, { status: "rejected" });
    logTicket(approval.callRef, order, {
      subject: `Refund for ${itemSummary(order)}`,
      status: "open",
      note: `Refund ${refund.id} of ${formatRupees(refund.amount)} denied on review (${approval.id}).`,
    });
    return approval;
  }

  const momentId = await startStep(approval.callRef, {
    kind: "action",
    system: "payments",
    title: `Issuing ${formatRupees(refund.amount)} refund`,
    detail: `To ${refund.method} · approved ${approval.id}`,
  });
  const processed = db.settleRefund(refund.id, { status: "processed", ...settlementFor(order) });
  if (!processed) {
    db.updateMoment(momentId, { status: "failed", title: "Refund was already settled elsewhere" });
    return approval;
  }
  await completeRefund(approval.callRef, order, processed, momentId);
  return approval;
}

// ---------- Tools ----------

async function lookupCustomer(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  recordUnderstanding(params, call);
  // Identity comes from the number we dialled, never from what the model heard; the param only matters outside our dialer.
  const phone = call.phone || readText(params, "phone");
  const momentId = await startStep(call.callRef, {
    kind: "lookup",
    system: "crm",
    title: "Looking up caller in CRM",
    detail: phone ? formatPhone(phone) : undefined,
  });

  const customer = phone ? db.findCustomerByPhone(phone) : null;
  if (!customer) {
    db.updateMoment(momentId, { status: "failed", title: "No customer on this number" });
    return {
      ok: false,
      found: false,
      say: "I couldn't find an account on this number. Could you share your order ID?",
    };
  }

  db.updateCall(call.callRef, { customerId: customer.id });
  const orders = db.listOrders(customer.id);
  const recent = orders.slice(0, 5).map((order) => ({
    order_id: order.id,
    item: itemSummary(order),
    amount: order.total,
    status: statusLabel(order, db.findRefundForOrder(order.id)),
  }));
  db.updateMoment(momentId, {
    status: "ok",
    title: `Caller is ${customer.name}`,
    detail: `${customer.tier.toUpperCase()} · ${customer.city} · ${orders.length} orders · ${formatRupees(customer.lifetimeValue)} lifetime`,
    touched: [customer.id],
    data: { customerId: customer.id, tier: customer.tier, flags: customer.flags, orderIds: orders.map((o) => o.id) },
  });

  // Abuse flags stay off the voice payload so the agent can never read them out to the caller.
  return {
    ok: true,
    found: true,
    customer: {
      id: customer.id,
      name: customer.name,
      city: customer.city,
      tier: customer.tier,
      language: customer.language,
    },
    orders: recent,
    say: `Found ${customer.name} from ${customer.city}. Recent orders: ${recent
      .slice(0, 3)
      .map((order) => `${order.item} (${spokenId(order.order_id)}), ${order.status}`)
      .join("; ")}.`,
  };
}

async function getOrderDetails(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const located = locateOrder(params, call, { kind: "lookup", system: "orders" });
  if (!located.found) return located.result;
  const { order } = located;

  const momentId = await startStep(call.callRef, { kind: "lookup", system: "orders", title: `Pulling order ${order.id}` });
  const diagnosis = diagnose(order, db.findRefundForOrder(order.id));
  db.updateMoment(momentId, {
    status: "ok",
    title: `${order.id} · ${itemSummary(order)}`,
    detail: diagnosis,
    touched: [order.id],
    data: { orderId: order.id, status: order.status, total: order.total, diagnosis },
  });

  if (order.return) {
    const { courier, awb } = order.shipment;
    const proofId = await startStep(call.callRef, {
      kind: "lookup",
      system: "courier",
      title: `Checking ${courier} pickup proof`,
      detail: `AWB ${awb}`,
    });
    const scan = order.shipment.events.find((event) => event.status === RETURN_PICKUP_SCAN);
    db.updateMoment(
      proofId,
      scan
        ? {
            status: "ok",
            title: `${courier} confirms pickup`,
            detail: `${formatDateTime(scan.at)} · ${scan.location} · AWB ${awb}`,
            touched: [order.id],
            data: { courier, awb, pickedAt: scan.at, location: scan.location },
          }
        : {
            status: "waiting",
            title: "Pickup not done yet",
            detail: `${courier} hasn't scanned the return · AWB ${awb}`,
            data: { courier, awb },
          },
    );
  }

  return {
    ok: true,
    order: orderBrief(order),
    diagnosis,
    say: `${itemSummary(order)}, order ${spokenId(order.id)}, ${spokenRupees(order.total)}. ${diagnosis}.`,
  };
}

async function checkRefund(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const located = locateOrder(params, call, { kind: "policy", system: "policy" });
  if (!located.found) return located.result;
  const { order } = located;

  const momentId = await startStep(call.callRef, {
    kind: "policy",
    system: "policy",
    title: `Checking refund policy for ${order.id}`,
  });
  const { decision } = evaluateRefundFor(order);
  db.updateMoment(momentId, policyMoment(order, decision));

  return {
    ok: true,
    order_id: order.id,
    outcome: decision.outcome,
    amount: order.total,
    reasons: decision.outcome === "deny" ? decision.reasons : undefined,
    say: policySay(order, decision),
  };
}

async function issueRefund(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const located = locateOrder(params, call, { kind: "action", system: "payments" });
  if (!located.found) return located.result;
  const { order } = located;
  const reason = readText(params, "reason") ?? "Customer requested a refund";

  const existing = db.findRefundForOrder(order.id);
  if (existing) return replayRefund(call, order, existing);

  const { decision, customer } = evaluateRefundFor(order);
  ensurePolicyMoment(call, order, decision);

  switch (decision.outcome) {
    case "deny":
      return {
        ok: false,
        status: "denied",
        order_id: order.id,
        reasons: decision.reasons,
        say: policySay(order, decision),
      };
    case "needs_approval":
      return requestApproval(call, order, customer, decision, reason);
    case "allow":
      return refundNow(call, order, reason);
  }
}

function spokenSlot(label: string): string {
  return label.replace(/\s*–\s*/, " and ");
}

async function rescheduleDelivery(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const located = locateOrder(params, call, { kind: "action", system: "courier" });
  if (!located.found) return located.result;
  const { order } = located;
  const { shipment } = order;

  const today = istDateKey();
  const rawDate = readText(params, "new_date");
  const rawSlot = readText(params, "slot");
  const date = rawDate ? parseDeliveryDate(rawDate, today) : null;
  const slotLabel = rawSlot ? parseSlot(rawSlot) : (shipment.slot ?? DELIVERY_SLOTS[0].label);

  const momentId = await startStep(call.callRef, {
    kind: "action",
    system: "courier",
    title: `Rescheduling ${order.id} with ${shipment.courier}`,
    detail: [rawDate, rawSlot].filter(Boolean).join(", ") || undefined,
    data: { orderId: order.id },
  });

  if (!date) {
    db.updateMoment(momentId, {
      status: "blocked",
      title: "Couldn't read the new date",
      detail: rawDate ? `"${rawDate}"` : "No date given",
    });
    return {
      ok: false,
      say: `Which day works for you? I can move it to any day in the next ${RESCHEDULE_WINDOW_DAYS} days.`,
    };
  }

  const decision = evaluateReschedule(order, { date, slot: slotLabel }, today);
  const slot = DELIVERY_SLOTS.find((candidate) => candidate.label === slotLabel);
  if (decision.outcome !== "allow" || !slot) {
    db.updateMoment(momentId, {
      status: "blocked",
      title: "Reschedule not possible",
      detail: decision.reasons.join(" · "),
      touched: [order.id],
      data: { checks: decision.checks },
    });
    return {
      ok: false,
      order_id: order.id,
      reasons: decision.reasons,
      available_slots: DELIVERY_SLOTS.map((candidate) => candidate.label),
      say: `I can't move it to that: ${decision.reasons.join("; ")}.`,
    };
  }

  const eta = atIst(date, slot.startHour).toISOString();
  db.updateOrder(order.id, {
    status: order.status === "out_for_delivery" ? "shipped" : order.status,
    shipment: {
      ...shipment,
      eta,
      slot: slot.label,
      status: `Rescheduled to ${formatShortDate(date)}`,
      events: [
        ...shipment.events,
        {
          at: new Date().toISOString(),
          status: `Delivery rescheduled to ${formatShortDate(date)}, ${slot.label}`,
          location: shipment.events.at(-1)?.location ?? shipment.courier,
        },
      ],
    },
  });
  db.updateMoment(momentId, {
    status: "ok",
    title: `Delivery moved to ${formatLongDate(date)}`,
    detail: `${slot.label} · ${shipment.courier} AWB ${shipment.awb}`,
    touched: [order.id],
    data: { from: shipment.eta, to: eta, slot: slot.label },
  });
  logTicket(call.callRef, order, {
    subject: `Delivery reschedule for ${order.id}`,
    status: "resolved",
    note: `Delivery moved to ${formatLongDate(date)}, ${slot.label}, at the customer's request.`,
  });

  const verified = await verifyStep(call.callRef, "courier", `Confirming new slot with ${shipment.courier}`, () => {
    const stored = db.getOrder(order.id)?.shipment;
    const matches = stored?.eta !== undefined && istDateKey(new Date(stored.eta)) === date && stored.slot === slot.label;
    return matches
      ? {
          passed: true,
          title: `${shipment.courier} shows the new slot`,
          detail: `AWB ${shipment.awb} · ${formatLongDate(date)}, ${slot.label}`,
          touched: [order.id],
        }
      : {
          passed: false,
          title: "Courier slot didn't update",
          detail: `AWB ${shipment.awb} shows ${stored?.eta ? formatDateTime(stored.eta) : "no date"}`,
        };
  });

  return {
    ok: true,
    order_id: order.id,
    new_date: formatLongDate(date),
    slot: slot.label,
    verified,
    say: `Done. Order ${spokenId(order.id)} will now arrive on ${formatLongDate(date)}, between ${spokenSlot(slot.label)}.`,
  };
}

async function updateAddress(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const located = locateOrder(params, call, { kind: "action", system: "orders" });
  if (!located.found) return located.result;
  const { order } = located;

  const line1 = readText(params, "address_line1");
  const pincode = readPincode(params, "pincode");
  if (!line1 || !pincode) {
    db.recordMoment({
      callRef: call.callRef,
      kind: "action",
      system: "orders",
      status: "blocked",
      title: "Address incomplete",
      detail: !line1 ? "Missing house and street" : "Missing pincode",
      touched: [order.id],
    });
    return { ok: false, say: "I need the full address: house number, street and the 6-digit pincode." };
  }

  const address: Address = {
    line1,
    line2: readText(params, "address_line2"),
    city: readText(params, "city") ?? order.address.city,
    pincode,
  };
  const momentId = await startStep(call.callRef, {
    kind: "action",
    system: "orders",
    title: `Updating delivery address on ${order.id}`,
    detail: oneLineAddress(address),
  });

  const decision = evaluateAddressChange(order, address);
  if (decision.outcome !== "allow") {
    db.updateMoment(momentId, {
      status: "blocked",
      title: "Address change not possible",
      detail: decision.reasons.join(" · "),
      touched: [order.id],
      data: { checks: decision.checks },
    });
    return {
      ok: false,
      order_id: order.id,
      reasons: decision.reasons,
      say: `I can't change the address on this order: ${decision.reasons.join("; ")}.`,
    };
  }

  db.updateOrder(order.id, {
    address,
    shipment: {
      ...order.shipment,
      events: [
        ...order.shipment.events,
        { at: new Date().toISOString(), status: "Delivery address updated", location: address.city },
      ],
    },
  });
  db.updateMoment(momentId, {
    status: "ok",
    title: "Delivery address updated",
    detail: `${oneLineAddress(order.address)} → ${oneLineAddress(address)}`,
    touched: [order.id],
    data: { from: order.address, to: address },
  });
  logTicket(call.callRef, order, {
    subject: `Address change for ${order.id}`,
    status: "resolved",
    note: `Delivery address changed to ${oneLineAddress(address)}.`,
  });

  const verified = await verifyStep(call.callRef, "orders", "Re-reading the order", () => {
    const stored = db.getOrder(order.id)?.address;
    const matches = stored !== undefined && oneLineAddress(stored) === oneLineAddress(address);
    return matches
      ? {
          passed: true,
          title: "Order shows the new address",
          detail: `${oneLineAddress(address)} · shared with ${order.shipment.courier}`,
          touched: [order.id],
        }
      : {
          passed: false,
          title: "Address didn't update",
          detail: stored ? `Order still shows ${oneLineAddress(stored)}` : "Order is missing",
        };
  });

  const { eta } = order.shipment;
  return {
    ok: true,
    order_id: order.id,
    deliver_to: oneLineAddress(address),
    arriving: eta ? formatLongDate(eta) : undefined,
    verified,
    say: `Done. Order ${spokenId(order.id)} will now be delivered to ${address.line1}, ${address.city} ${address.pincode}${eta ? `, still arriving ${formatLongDate(eta)}` : ""}.`,
  };
}

async function sendInvoice(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const located = locateOrder(params, call, { kind: "action", system: "orders" });
  if (!located.found) return located.result;
  const { order } = located;

  const invoice = order.invoiceId ? db.getInvoice(order.invoiceId) : null;
  if (!invoice) {
    db.recordMoment({
      callRef: call.callRef,
      kind: "action",
      system: "orders",
      status: "blocked",
      title: `No invoice yet for ${order.id}`,
      detail: `Order is ${humanStatus(order.status)}`,
      touched: [order.id],
    });
    return {
      ok: false,
      order_id: order.id,
      say: "The invoice for this order isn't generated yet. It's emailed automatically once the order is delivered.",
    };
  }

  const momentId = await startStep(call.callRef, {
    kind: "action",
    system: "orders",
    title: `Sending invoice ${invoice.number}`,
    detail: `${formatRupees(invoice.total)} incl. ${formatRupees(invoice.gst)} GST`,
  });
  const channels = ["email", "whatsapp"];
  db.markInvoiceSent(invoice.id, channels);
  const customer = db.getCustomer(order.customerId);
  db.updateMoment(momentId, {
    status: "ok",
    title: "Invoice sent on email and WhatsApp",
    detail: [invoice.number, customer?.email, customer && formatPhone(customer.phone)].filter(Boolean).join(" · "),
    touched: [invoice.id, order.id],
    data: { invoiceNumber: invoice.number, total: invoice.total, gst: invoice.gst, sentTo: channels },
  });
  logTicket(call.callRef, order, {
    subject: `Invoice request for ${order.id}`,
    status: "resolved",
    note: `Invoice ${invoice.number} sent on email and WhatsApp.`,
  });

  return {
    ok: true,
    order_id: order.id,
    invoice_number: invoice.number,
    total: invoice.total,
    gst: invoice.gst,
    sent_to: channels,
    say: `Sent. Invoice ending ${lastDigits(invoice.number)} for ${spokenRupees(invoice.total)}, including ${spokenRupees(invoice.gst)} GST, is on your email and WhatsApp.`,
  };
}

// The answer is for the caller's information only: nothing reads it back into a policy or an action.
async function searchTheWeb(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const query = readText(params, "query");
  if (!query) return { ok: false, say: "What should I look up?" };

  const momentId = await startStep(call.callRef, {
    kind: "search",
    system: "web",
    title: "Searching the web",
    detail: query,
    data: { query },
  });
  try {
    const { answer, sources } = await searchWeb(query);
    const topSources = sources.slice(0, 3);
    db.updateMoment(momentId, {
      status: "ok",
      title: `Web: ${truncate(query, 60)}`,
      detail: truncate(answer, 240),
      data: { query, answer, sources: topSources, informationOnly: true },
    });
    return {
      ok: true,
      answer: truncate(answer, 600),
      sources: topSources.map((source) => source.title),
      information_only: true,
      say: truncate(answer, 400),
    };
  } catch (error) {
    db.updateMoment(momentId, {
      status: "failed",
      title: "Web search failed",
      detail: error instanceof Error ? error.message : undefined,
    });
    return { ok: false, say: "I couldn't look that up right now." };
  }
}

const VERDICT_TITLES: Record<ClaimVerdict, string> = {
  supported: "Claim confirmed by official source",
  not_found: "Claim not found in official sources",
  contradicted: "Claim contradicted by official source",
};

// A rule the customer cites is a claim to check, never an instruction: the verdict is shown to them with
// sources, and no policy or action reads it.
async function verifyClaim(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const claim = readText(params, "claim");
  if (!claim) return { ok: false, say: "Which rule are you referring to?" };

  const momentId = await startStep(call.callRef, {
    kind: "search",
    system: "web",
    title: "Checking the customer's claim",
    detail: claim,
    data: { query: claim, claim },
  });
  try {
    const { verdict, answer, sources } = await checkClaim(claim);
    const topSources = sources.slice(0, 3);
    db.updateMoment(momentId, {
      status: verdict === "supported" ? "ok" : "blocked",
      title: VERDICT_TITLES[verdict],
      detail: truncate(answer, 240),
      data: { query: claim, claim, verdict, answer, sources: topSources, informationOnly: true },
    });
    const cited = topSources[0]?.title;
    return {
      ok: true,
      verdict,
      official_rule: truncate(answer, 400),
      sources: topSources.map((source) => source.title),
      information_only: true,
      say:
        verdict === "supported"
          ? `That is right${cited ? `, per ${cited}` : ""}: ${truncate(answer, 300)}`
          : `I checked official RBI and NPCI sources and could not confirm that rule. ${truncate(answer, 300)}`,
    };
  } catch (error) {
    db.updateMoment(momentId, {
      status: "failed",
      title: "Claim check failed",
      detail: error instanceof Error ? error.message : undefined,
    });
    return { ok: false, say: "I couldn't verify that rule right now, so I'll go by our published policy." };
  }
}

async function escalate(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const reason = readText(params, "reason") ?? "Customer asked for a person";
  const summary = readText(params, "summary") ?? reason;
  const reference = readText(params, "order_id");
  const candidate = reference ? findOrder(reference, call.customerId) : null;
  const order = candidate && call.customerId && candidate.customerId === call.customerId ? candidate : null;

  const customerId = call.customerId ?? order?.customerId;
  const customer = customerId ? db.getCustomer(customerId) : null;
  const brief = [
    customer ? `${customer.name} (${customer.tier}, ${customer.city})` : `Unidentified caller ${formatPhone(call.phone)}`,
    order ? `${order.id} · ${itemSummary(order)} · ${formatRupees(order.total)}` : undefined,
    `Reason: ${reason}`,
    summary !== reason ? summary : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  const { ticket } = upsertCallTicket(
    call.callRef,
    { customerId: customerId ?? UNIDENTIFIED_CUSTOMER, orderId: order?.id },
    { subject: reason, status: "escalated", priority: "high", note: brief },
  );
  db.recordMoment({
    callRef: call.callRef,
    kind: "escalated",
    system: "helpdesk",
    status: "ok",
    title: `Escalated to a person · ${ticket.id}`,
    detail: brief,
    touched: [ticket.id],
    data: { ticketId: ticket.id, reason, summary, orderId: order?.id },
  });

  return {
    ok: true,
    ticket_id: ticket.id,
    callback_within_hours: ESCALATION_CALLBACK_HOURS,
    say: `I've handed this to a senior teammate with all the details, ticket ${spokenId(ticket.id)}. They'll call you back within ${ESCALATION_CALLBACK_HOURS} hours.`,
  };
}

async function noteIntent(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  return recordUnderstanding(params, call) ? { ok: true, say: "Noted." } : { ok: false, say: "No intent given." };
}

const TOOLS = {
  lookup_customer: lookupCustomer,
  get_order: getOrderDetails,
  check_refund: checkRefund,
  issue_refund: issueRefund,
  reschedule_delivery: rescheduleDelivery,
  update_address: updateAddress,
  send_invoice: sendInvoice,
  search_web: searchTheWeb,
  verify_claim: verifyClaim,
  escalate,
  note_intent: noteIntent,
} satisfies Record<string, ToolHandler>;

export type ToolName = keyof typeof TOOLS;

export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOLS, name);
}

export function runTool(name: ToolName, params: ToolParams): Promise<ToolResult> {
  return TOOLS[name](params, callForTool(params));
}
