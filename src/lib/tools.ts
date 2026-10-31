import * as db from "@/lib/db";
import {
  addBusinessDays,
  calendarDaysBetween,
  formatDateTime,
  formatDayMonth,
  formatLongDate,
  formatMonth,
  formatPhone,
  formatRupees,
  formatShortDate,
  formatTime,
  istDateKey,
  lastDigits,
  shiftDateKey,
  spokenRupees,
  truncate,
} from "@/lib/format";
import { payoutKey, randomDigits, upiRrn, voiceSafeId } from "@/lib/ids";
import {
  CASHBACK_AUTO_LIMIT,
  ESCALATION_CALLBACK_HOURS,
  LENDER_GRIEVANCE_DAYS,
  RENT_REFUND_AUTO_LIMIT,
  REPLACEMENT_DELIVERY_WORKING_DAYS,
  UDIR_RESOLUTION_WORKING_DAYS,
  UPI_DELAY_COMPENSATION_PER_DAY,
  bankCompensationDue,
  chargesAfterReturn,
  evaluateCashback,
  evaluateDeviceAction,
  evaluateDispute,
  evaluateLenderGrievance,
  evaluateRentRefund,
  evaluateSettlementRetry,
  findDuplicateDeductions,
  lenderResolutionDue,
  reversalDaysLate,
  reversalDeadline,
  reversalTatDays,
  settlementNeedsNewBank,
  settlementNeedsReview,
  udirExpectedBy,
  evaluateFlag,
  type DeviceAction,
  type DuplicateDeduction,
} from "@/lib/policy";
import { checkClaim, searchWeb, type ClaimVerdict } from "@/lib/search";
import type { DeviceRecord } from "@/lib/seed";
import { parsePastDate, parseSince, readAmount, readText, type ToolParams } from "@/lib/tool-input";
import type {
  Approval,
  CallRecord,
  Customer,
  Dispute,
  Loan,
  Moment,
  MomentKind,
  Payout,
  PolicyDecision,
  ProfileKind,
  Reward,
  Settlement,
  SystemName,
  Ticket,
  TxnStatus,
  UpiTransaction,
} from "@/lib/types";

export interface ToolResult {
  ok: boolean;
  /** One or two plain sentences the voice agent can paraphrase to the caller. */
  say: string;
  [field: string]: unknown;
}

type ToolHandler = (params: ToolParams, call: CallRecord) => Promise<ToolResult>;

/** A record the caller is allowed to act on, or the reply explaining why not. */
type Found<T> = { ok: true; value: T } | { ok: false; result: ToolResult };

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

function recordUnderstanding(params: ToolParams, call: CallRecord): void {
  const intent = readText(params, "intent");
  if (!intent) return;
  const sentiment = readText(params, "sentiment");
  const language = readText(params, "language");
  const detail = [sentiment && `Sentiment: ${sentiment}`, language && `Language: ${language}`].filter(Boolean).join(" · ");
  db.recordMoment({
    callRef: call.callRef,
    kind: "understood",
    status: "ok",
    title: intent,
    detail: detail || undefined,
    data: { intent, sentiment, language },
  });
}

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

// ---------- Speaking ----------

function ending(reference: string): string {
  return `ending ${lastDigits(reference)}`;
}

function accountOf(customer: Customer, last4 = customer.bank.last4): string {
  return `${customer.bank.bank} account ending ${last4}`;
}

function shortAccount(customer: Customer, last4 = customer.bank.last4): string {
  return `${customer.bank.bank} ••${last4}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function listing(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function spokenWhen(iso: string, now: Date = new Date()): string {
  const days = calendarDaysBetween(iso, now);
  if (days <= 0) return `today at ${formatTime(iso)}`;
  if (days === 1) return `yesterday at ${formatTime(iso)}`;
  return `on ${formatDayMonth(iso)}`;
}

/** "10:18 am" today, "yesterday at 6:12 pm", or "29 October" further back. */
function clockOrDay(iso: string, now: Date = new Date()): string {
  const days = calendarDaysBetween(iso, now);
  if (days <= 0) return formatTime(iso);
  return days === 1 ? `yesterday at ${formatTime(iso)}` : formatDayMonth(iso);
}

function standing(customer: Customer): string {
  return customer.flags.length > 0 ? `flagged ${customer.flags.join(", ")}` : "no flags";
}

function sinceYear(customer: Customer): string {
  return customer.since.slice(0, 4);
}

// ---------- Matching what the caller said ----------

const STOP_WORDS = new Set([
  "the", "and", "for", "from", "with", "paid", "payment", "payments", "rupees", "rupee", "wala", "wale", "wali",
  "tha", "thi", "hai", "kiya", "kia", "bheja", "bheje", "diya", "diye", "maine", "mera", "meri", "mere", "wapas",
]);

// Callers name things the way they think of them ("bijli ka bill", "dawai wale"), not the way the ledger does.
const ALIASES: Record<string, string[]> = {
  bijli: ["electricity", "power", "bses"],
  light: ["electricity", "power", "bses"],
  electricity: ["power", "bses"],
  hawai: ["flight"],
  jahaz: ["flight"],
  plane: ["flight"],
  ticket: ["flight"],
  dawai: ["medic", "chemist", "pharma"],
  dawa: ["medic", "chemist", "pharma"],
  chemist: ["medic", "pharma"],
  pharmacy: ["medic", "chemist"],
  medical: ["medic"],
  doodh: ["dairy", "milk"],
  milk: ["dairy"],
  chai: ["tea"],
  metro: ["dmrc"],
  mobile: ["recharge"],
  khana: ["swiggy", "zomato"],
  food: ["swiggy", "zomato"],
  grocery: ["blinkit", "grocer"],
  sabzi: ["blinkit", "grocer"],
};

function searchTerms(text: string | undefined): string[] {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
  return [...new Set(words.flatMap((word) => [word, ...(ALIASES[word] ?? [])]))];
}

function mentions(haystack: string, terms: string[]): boolean {
  const text = haystack.toLowerCase();
  return terms.some((term) => text.includes(term) || (term.length >= 6 && text.includes(term.slice(0, 5))));
}

function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

function endsWithDigits(value: string | undefined, digits: string): boolean {
  return value !== undefined && digits.length >= 3 && digitsOf(value).endsWith(digits);
}

function asId(text: string): string {
  return text.trim().toUpperCase().replace(/\s+/g, "-");
}

// ---------- Caller ----------

/** Identity is bound to the number we dialled; a model-supplied name or phone never selects an account. */
function callerOf(call: CallRecord): Customer | null {
  if (call.customerId) return db.getCustomer(call.customerId);
  const customer = call.phone ? db.findCustomerByPhone(call.phone) : null;
  if (customer) db.updateCall(call.callRef, { customerId: customer.id });
  return customer;
}

const ACCOUNT_LABEL: Record<ProfileKind, string> = {
  consumer: "personal Paytm account",
  merchant: "Paytm for Business account",
};

function requireCaller(call: CallRecord, system: SystemName, kind?: ProfileKind): Found<Customer> {
  const customer = callerOf(call);
  if (customer && (!kind || customer.kind === kind)) return { ok: true, value: customer };
  db.recordMoment({
    callRef: call.callRef,
    kind: "lookup",
    system,
    status: "failed",
    title: customer ? `Not a ${kind} account` : "Caller not verified",
    detail: customer ? `${customer.name} has a ${ACCOUNT_LABEL[customer.kind]}` : formatPhone(call.phone) || undefined,
  });
  return {
    ok: false,
    result: {
      ok: false,
      say:
        customer && kind
          ? `This number has a ${ACCOUNT_LABEL[customer.kind]}, not a ${ACCOUNT_LABEL[kind]}, so I can't see that here.`
          : "I need to find your account first. Let me look it up on the number I called.",
    },
  };
}

function notFound(
  call: CallRecord,
  step: { kind: MomentKind; system: SystemName },
  title: string,
  detail: string | undefined,
  say: string,
  extra: Record<string, unknown> = {},
): { ok: false; result: ToolResult } {
  db.recordMoment({ callRef: call.callRef, ...step, status: "failed", title, detail });
  return { ok: false, result: { ok: false, say, ...extra } };
}

// ---------- Helpdesk ----------

interface TicketChange {
  category: Ticket["category"];
  subject: string;
  status: Ticket["status"];
  priority?: Ticket["priority"];
  routedTo?: string;
  note: string;
}

/** Reuses the customer's ticket for the same record if it is still open or was touched during this call. */
function upsertCallTicket(
  callRef: string,
  target: { customerId: string; relatedId?: string },
  change: TicketChange,
): { ticket: Ticket; created: boolean } {
  const call = db.getCall(callRef);
  const existing = db
    .listTickets(target.customerId)
    .find(
      (ticket) =>
        ticket.relatedId === target.relatedId &&
        ticket.category === change.category &&
        (ticket.status !== "resolved" || (call !== null && ticket.updatedAt >= call.startedAt)),
    );
  if (existing) {
    const ticket = db.updateTicket(existing.id, {
      status: change.status,
      priority: change.priority ?? existing.priority,
      routedTo: change.routedTo ?? existing.routedTo,
      notes: [...existing.notes, change.note],
    });
    if (ticket) return { ticket, created: false };
  }
  const ticket = db.createTicket({
    customerId: target.customerId,
    category: change.category,
    relatedId: target.relatedId,
    subject: change.subject,
    status: change.status,
    priority: change.priority ?? "normal",
    routedTo: change.routedTo,
    notes: [change.note],
  });
  return { ticket, created: true };
}

function logTicket(callRef: string, target: { customerId: string; relatedId?: string }, change: TicketChange): Ticket {
  const { ticket, created } = upsertCallTicket(callRef, target, change);
  const verb = ticket.status === "resolved" ? "resolved" : created ? "opened" : "updated";
  db.recordMoment({
    callRef,
    kind: "action",
    system: "helpdesk",
    status: "ok",
    title: `Ticket ${ticket.id} ${verb}`,
    detail: change.note,
    touched: [ticket.id],
    data: { ticketId: ticket.id, status: ticket.status, category: ticket.category, relatedId: ticket.relatedId },
  });
  return ticket;
}

// ---------- Policy on the console ----------

interface PolicySubject {
  id: string;
  topic: string;
  amount?: number;
  touched?: string[];
}

function policyFields(subject: PolicySubject, decision: PolicyDecision): Partial<Moment> {
  const passed = decision.checks.filter((check) => check.passed).length;
  const headline = {
    allow: `${subject.topic} allowed`,
    needs_approval: `${subject.topic} needs one-tap approval`,
    deny: `${subject.topic} blocked`,
  }[decision.outcome];
  return {
    status: decision.outcome === "deny" ? "blocked" : "ok",
    title: `${headline} · ${passed}/${decision.checks.length} checks passed`,
    detail: decision.reasons.join(" · "),
    touched: subject.touched ?? [subject.id],
    data: {
      subjectId: subject.id,
      topic: subject.topic,
      amount: subject.amount,
      outcome: decision.outcome,
      checks: decision.checks,
      reasons: decision.reasons,
    },
  };
}

async function showPolicy(call: CallRecord, subject: PolicySubject, decision: PolicyDecision): Promise<void> {
  const momentId = await startStep(call.callRef, {
    kind: "policy",
    system: "policy",
    title: `Checking ${subject.topic.toLowerCase()} rules`,
    data: { subjectId: subject.id, topic: subject.topic },
  });
  db.updateMoment(momentId, policyFields(subject, decision));
}

/** An action re-checks policy itself, but only shows the checklist if the check tool hasn't already. */
async function ensurePolicyShown(call: CallRecord, subject: PolicySubject, decision: PolicyDecision): Promise<void> {
  const shown = db
    .listMoments(call.callRef)
    .some(
      (moment) =>
        moment.kind === "policy" &&
        moment.data?.subjectId === subject.id &&
        moment.data?.topic === subject.topic &&
        moment.data?.outcome === decision.outcome,
    );
  if (!shown) await showPolicy(call, subject, decision);
}

// ---------- Payouts: cashback, rent refunds and settlement retries share one ledger ----------

interface PayoutView {
  system: SystemName;
  noun: string;
  actionTitle: string;
  doneTitle: string;
  verifyTitle: string;
  destination: string;
  ticket: { category: Ticket["category"]; subject: string };
  touched: string[];
  /** What the caller hears once the money has moved. */
  paidSay: (payout: Payout) => string;
  verify: (payoutId: string) => Verification;
}

function cashbackView(rewardId: string, customer: Customer, amount: number): PayoutView {
  const reward = db.getReward(rewardId);
  return {
    system: "rewards",
    noun: "cashback",
    actionTitle: `Crediting ${formatRupees(amount)} cashback`,
    doneTitle: `Cashback credited · ${formatRupees(amount)}`,
    verifyTitle: "Re-reading the rewards ledger",
    destination: shortAccount(customer),
    ticket: { category: "rewards", subject: `Cashback not received: ${reward?.offer ?? rewardId}` },
    touched: reward ? [reward.id, reward.txnId] : [rewardId],
    paidSay: (payout) =>
      `${spokenRupees(payout.amount)} cashback is credited to your ${accountOf(customer)}, reference ${ending(payout.rrn ?? payout.id)}.`,
    verify: (payoutId) => {
      const payout = db.getPayout(payoutId);
      const stored = db.getReward(rewardId);
      return payout?.status === "processed" && stored?.status === "credited" && stored.payoutId === payout.id
        ? {
            passed: true,
            title: "Rewards ledger shows the cashback credited",
            detail: `${stored.id} · credited · ${formatRupees(payout.amount)} · RRN ${payout.rrn}`,
            touched: [stored.id, payout.id],
          }
        : {
            passed: false,
            title: "Rewards ledger doesn't confirm the credit",
            detail: stored ? `${stored.id} shows ${stored.status}` : `${rewardId} is missing from the ledger`,
          };
    },
  };
}

function rentRefundView(deviceId: string, customer: Customer, amount: number): PayoutView {
  const device = db.getDevice(deviceId);
  const model = device?.model ?? "device";
  const late = device ? chargesAfterReturn(device, db.listRentalCharges(deviceId)) : [];
  const months = late.map((charge) => formatMonth(charge.period).split(" ")[0]);
  return {
    system: "billing",
    noun: "rent refund",
    actionTitle: `Refunding ${formatRupees(amount)} rent`,
    doneTitle: `Rent refunded · ${formatRupees(amount)} · billing stopped`,
    verifyTitle: "Re-reading billing",
    destination: shortAccount(customer),
    ticket: { category: "billing", subject: `Rent charged after ${model} return` },
    touched: [deviceId, ...late.map((charge) => charge.id)],
    paidSay: (payout) =>
      `${spokenRupees(payout.amount)} is refunded to your ${accountOf(customer)} for the ${listing(months)} rent, ` +
      `reference ${ending(payout.rrn ?? payout.id)}. I've also stopped the rent on the returned ${model}, so it won't be charged again.`,
    verify: (payoutId) => {
      const payout = db.getPayout(payoutId);
      const stored = db.getDevice(deviceId);
      const charges = stored ? chargesAfterReturn(stored, db.listRentalCharges(deviceId)) : [];
      const refunded = charges.filter((charge) => charge.status === "refunded" && charge.payoutId === payoutId);
      const passed =
        payout?.status === "processed" && stored !== null && !stored.rental.billingActive && refunded.length === charges.length;
      return passed
        ? {
            passed,
            title: "Billing shows the rent refunded and stopped",
            detail: `${refunded.map((charge) => formatMonth(charge.period)).join(", ")} refunded · billing off for ${deviceId} · RRN ${payout?.rrn}`,
            touched: [deviceId, ...refunded.map((charge) => charge.id)],
          }
        : {
            passed: false,
            title: "Billing doesn't confirm the refund",
            detail: stored?.rental.billingActive ? "Billing is still active on the returned device" : "Charges still show as unpaid",
          };
    },
  };
}

function settlementRetryView(settlementId: string, customer: Customer, amount: number): PayoutView {
  const settlement = db.getSettlement(settlementId);
  const last4 = settlement?.bankLast4 ?? customer.bank.last4;
  const forDay = settlement ? formatDayMonth(settlement.forDate) : "that day";
  return {
    system: "settlements",
    noun: "settlement",
    actionTitle: `Re-sending ${formatRupees(amount)} settlement`,
    doneTitle: `Settlement sent · ${formatRupees(amount)}`,
    verifyTitle: `Checking the credit with ${customer.bank.bank}`,
    destination: shortAccount(customer, last4),
    ticket: { category: "settlement", subject: `Settlement for ${forDay} failed` },
    touched: [settlementId],
    paidSay: (payout) =>
      `The ${spokenRupees(payout.amount)} settlement for ${forDay} has been sent again and ${customer.bank.bank} confirmed it, ` +
      `UTR ${ending(payout.rrn ?? payout.id)}. It should show in your ${accountOf(customer, last4)} within a few minutes.`,
    verify: (payoutId) => {
      const payout = db.getPayout(payoutId);
      const stored = db.getSettlement(settlementId);
      return payout?.status === "processed" && stored?.status === "settled" && stored.utr === payout.rrn
        ? {
            passed: true,
            title: `${customer.bank.bank} confirms the settlement credit`,
            detail: `${stored.id} · settled ${formatRupees(stored.amount)} · UTR ${stored.utr}`,
            touched: [stored.id, payout.id],
          }
        : {
            passed: false,
            title: "Bank doesn't confirm the settlement",
            detail: stored ? `${stored.id} shows ${stored.status}` : `${settlementId} is missing`,
          };
    },
  };
}

function payoutView(kind: Payout["kind"], subjectId: string, customer: Customer, amount: number): PayoutView {
  switch (kind) {
    case "cashback":
      return cashbackView(subjectId, customer, amount);
    case "rent_refund":
      return rentRefundView(subjectId, customer, amount);
    case "settlement_retry":
      return settlementRetryView(subjectId, customer, amount);
  }
}

function newPayout(
  customerId: string,
  kind: Payout["kind"],
  subjectId: string,
  amount: number,
  status: "processed" | "pending_approval",
): Payout {
  return {
    id: voiceSafeId("PO"),
    customerId,
    kind,
    subjectId,
    amount,
    status,
    idempotencyKey: payoutKey(kind, subjectId),
    createdAt: new Date().toISOString(),
    ...(status === "processed" ? { rrn: upiRrn() } : {}),
  };
}

function payoutOutcome(payout: Payout, view: PayoutView, duplicate = false): ToolResult {
  const base = { payout_id: payout.id, subject_id: payout.subjectId, amount: payout.amount, duplicate };
  switch (payout.status) {
    case "processed":
      return {
        ok: true,
        status: "processed",
        ...base,
        reference_last4: payout.rrn ? lastDigits(payout.rrn) : undefined,
        say: `${duplicate ? "This was already done, so nothing was paid twice." : "Done."} ${view.paidSay(payout)}`,
      };
    case "pending_approval":
      return {
        ok: true,
        status: "pending",
        ...base,
        say: `I've sent the ${spokenRupees(payout.amount)} ${view.noun} to a Paytm specialist for approval. You'll get an SMS the moment it's done.`,
      };
    case "rejected":
      return {
        ok: false,
        status: "denied",
        ...base,
        say: `A Paytm specialist reviewed this ${view.noun} and couldn't approve it right now. I can have them call you back with the reason.`,
      };
  }
}

// A voice tool can't receive a callback, so the turn is held open while a person taps approve
// on the console. The approval route does the paying; this only watches for the outcome.
async function waitForPayout(payoutId: string): Promise<Payout> {
  const deadline = Date.now() + APPROVAL_WAIT_MS;
  let payout = db.getPayout(payoutId);
  while (payout?.status === "pending_approval" && Date.now() < deadline) {
    await sleep(APPROVAL_POLL_MS);
    payout = db.getPayout(payoutId);
  }
  if (!payout) throw new Error(`Payout ${payoutId} disappeared while awaiting approval`);
  return payout;
}

// Voice agents re-fire a tool when a turn is repeated or interrupted. Answering with the payout
// already on record turns that into a no-op instead of a second payment.
async function replayPayout(call: CallRecord, payout: Payout, momentId?: string): Promise<ToolResult> {
  const customer = db.getCustomer(payout.customerId);
  if (!customer) throw new Error(`Payout ${payout.id} has no customer record`);
  const view = payoutView(payout.kind, payout.subjectId, customer, payout.amount);
  const caught: Partial<Moment> & Pick<Moment, "kind" | "status" | "title"> = {
    kind: "verified",
    system: view.system,
    status: "ok",
    title: `Duplicate ${view.noun} request caught`,
    detail: `${payout.id} is already ${payout.status.replace(/_/g, " ")}; nothing paid twice`,
    touched: [payout.id],
    data: { payoutId: payout.id, subjectId: payout.subjectId, duplicate: true },
  };
  if (momentId) db.updateMoment(momentId, caught);
  else db.recordMoment({ ...caught, callRef: call.callRef });

  const current = payout.status === "pending_approval" ? await waitForPayout(payout.id) : payout;
  return payoutOutcome(current, view, true);
}

async function completePayout(callRef: string, payout: Payout, view: PayoutView, momentId: string): Promise<boolean> {
  db.updateMoment(momentId, {
    status: "ok",
    title: view.doneTitle,
    detail: `${payout.id} to ${view.destination} · RRN ${payout.rrn}`,
    touched: [payout.id, ...view.touched],
    data: { payoutId: payout.id, kind: payout.kind, amount: payout.amount, rrn: payout.rrn },
  });
  logTicket(
    callRef,
    { customerId: payout.customerId, relatedId: payout.subjectId },
    { ...view.ticket, status: "resolved", note: `${view.doneTitle}: ${payout.id} to ${view.destination}, RRN ${payout.rrn}.` },
  );
  return verifyStep(callRef, view.system, view.verifyTitle, () => view.verify(payout.id));
}

interface PayoutRequest {
  call: CallRecord;
  customer: Customer;
  kind: Payout["kind"];
  subjectId: string;
  amount: number;
  decision: PolicyDecision;
  reason: string;
  brief: string;
}

async function payNow(request: PayoutRequest, view: PayoutView): Promise<ToolResult> {
  const { call, customer, kind, subjectId, amount, reason } = request;
  const momentId = await startStep(call.callRef, {
    kind: "action",
    system: view.system,
    title: view.actionTitle,
    detail: `To ${view.destination} · ${reason}`,
    data: { subjectId, amount },
  });
  const { payout, created } = db.recordPayout(newPayout(customer.id, kind, subjectId, amount, "processed"));
  if (!created) return replayPayout(call, payout, momentId);

  const verified = await completePayout(call.callRef, payout, view, momentId);
  return { ...payoutOutcome(payout, view), verified };
}

async function requestApproval(request: PayoutRequest, view: PayoutView): Promise<ToolResult> {
  const { call, customer, kind, subjectId, amount, reason, brief } = request;
  const { payout, created } = db.recordPayout(newPayout(customer.id, kind, subjectId, amount, "pending_approval"));
  if (!created) return replayPayout(call, payout);

  const approval = db.createApproval({ callRef: call.callRef, customerId: customer.id, kind, subjectId, amount, reason, brief });
  db.recordMoment({
    callRef: call.callRef,
    kind: "approval",
    system: view.system,
    status: "waiting",
    title: `Waiting for one-tap approval · ${formatRupees(amount)} ${view.noun}`,
    detail: brief,
    touched: [approval.id, payout.id, ...view.touched],
    data: { approvalId: approval.id, payoutId: payout.id, subjectId, kind, amount, reason, brief },
  });

  const settled = await waitForPayout(payout.id);
  if (settled.status === "pending_approval") {
    logTicket(
      call.callRef,
      { customerId: customer.id, relatedId: subjectId },
      {
        ...view.ticket,
        status: "open",
        note: `${formatRupees(amount)} ${view.noun} awaiting approval ${approval.id}; customer told a specialist will confirm.`,
      },
    );
  }
  return payoutOutcome(settled, view);
}

async function movePayout(request: PayoutRequest): Promise<ToolResult> {
  const view = payoutView(request.kind, request.subjectId, request.customer, request.amount);
  return request.decision.outcome === "needs_approval" ? requestApproval(request, view) : payNow(request, view);
}

/** Records a person's decision and, on approval, makes the payout; the waiting tool call picks up the result. */
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
        ? { status: "ok", title: `Approved by a Paytm specialist in ${seconds}s · ${formatRupees(approval.amount)}` }
        : { status: "blocked", title: `Declined by a Paytm specialist · ${formatRupees(approval.amount)}` },
    );
  }

  const payout = db.findPayout(approval.kind, approval.subjectId);
  const customer = db.getCustomer(approval.customerId);
  if (!payout || payout.status !== "pending_approval" || !customer) return approval;
  const view = payoutView(payout.kind, payout.subjectId, customer, payout.amount);

  if (decision === "denied") {
    db.settlePayout(payout.id, { status: "rejected" });
    logTicket(
      approval.callRef,
      { customerId: customer.id, relatedId: payout.subjectId },
      { ...view.ticket, status: "open", note: `${formatRupees(payout.amount)} ${view.noun} declined on review (${approval.id}).` },
    );
    return approval;
  }

  const momentId = await startStep(approval.callRef, {
    kind: "action",
    system: view.system,
    title: view.actionTitle,
    detail: `To ${view.destination} · approved ${approval.id}`,
    data: { subjectId: payout.subjectId, amount: payout.amount, approvalId: approval.id },
  });
  const processed = db.settlePayout(payout.id, { status: "processed", rrn: upiRrn() });
  if (!processed) {
    db.updateMoment(momentId, { status: "failed", title: "Payout was already settled elsewhere" });
    return approval;
  }
  await completePayout(approval.callRef, processed, view, momentId);
  return approval;
}

// ---------- Consumer: UPI payments ----------

const TXN_STATUS: Record<TxnStatus, string> = {
  success: "successful",
  failed: "failed",
  pending: "pending",
  debited_not_credited: "debited, not credited",
  flagged: "flagged for investigation",
  reversed: "reversed",
};

function isStuck(txn: UpiTransaction): boolean {
  return txn.status === "debited_not_credited" || txn.status === "pending";
}

interface TxnQuery {
  ref?: string;
  amount?: number;
  counterparty?: string;
  day?: string;
}

function txnQuery(params: ToolParams, refKeys: string[]): TxnQuery {
  const when = readText(params, "when") ?? readText(params, "date");
  return {
    ref: refKeys.map((key) => readText(params, key)).find((value) => value !== undefined),
    amount: readAmount(params, "amount"),
    counterparty: readText(params, "counterparty"),
    day: when ? (parsePastDate(when) ?? undefined) : undefined,
  };
}

function describeQuery(query: TxnQuery): string {
  return (
    [query.ref, query.amount !== undefined && formatRupees(query.amount), query.counterparty, query.day && formatShortDate(query.day)]
      .filter(Boolean)
      .join(" · ") || "Latest payment with a problem"
  );
}

/** Only the caller's own transactions are searched, so another customer's reference simply isn't found. */
function findTransaction(txns: UpiTransaction[], query: TxnQuery): UpiTransaction | null {
  const ref = query.ref;
  if (ref) {
    const id = asId(ref);
    const digits = digitsOf(ref);
    const byRef =
      txns.find((txn) => txn.id === id) ??
      (digits.length >= 4
        ? txns.find(
            (txn) => endsWithDigits(txn.rrn, digits) || endsWithDigits(txn.reversal?.rrn, digits) || endsWithDigits(txn.id, digits),
          )
        : undefined);
    if (byRef) return byRef;
  }

  const terms = searchTerms(query.counterparty ?? (ref && !/\d/.test(ref) ? ref : undefined));
  const hasCriteria = query.amount !== undefined || terms.length > 0 || query.day !== undefined;
  if (!hasCriteria) return ref ? null : (txns.find(isStuck) ?? txns.find((txn) => txn.status === "reversed") ?? null);

  let best: UpiTransaction | null = null;
  let bestScore = 0;
  for (const txn of txns) {
    let score = 0;
    if (query.amount !== undefined && Math.abs(txn.amount - query.amount) < 0.5) score += 4;
    if (terms.length > 0 && mentions(`${txn.counterparty.name} ${txn.counterparty.vpa}`, terms)) score += 3;
    if (query.day) {
      const gap = Math.abs(calendarDaysBetween(`${query.day}T12:00:00+05:30`, txn.at));
      score += gap === 0 ? 2 : gap === 1 ? 1 : 0;
    }
    if (score > 0 && txn.status !== "success") score += 0.5;
    if (score > bestScore) {
      best = txn;
      bestScore = score;
    }
  }
  return best;
}

function txnBrief(txn: UpiTransaction) {
  const deadline = isStuck(txn) ? (txn.reversal?.deadline ?? reversalDeadline(txn).toISOString()) : undefined;
  return {
    txn_id: txn.id,
    amount: txn.amount,
    direction: txn.direction === "debit" ? "paid" : "received",
    party: txn.counterparty.name,
    when: formatDateTime(txn.at),
    status: TXN_STATUS[txn.status],
    rrn_last4: lastDigits(txn.rrn),
    reversal_ref_last4: txn.reversal?.rrn ? lastDigits(txn.reversal.rrn) : undefined,
    bank_must_reverse_by: deadline ? formatLongDate(deadline) : undefined,
    dispute_id: txn.disputeId,
  };
}

interface TxnDiagnosis {
  line: string;
  say: string;
  nextStep?: string;
}

/** The one line a support lead would want before picking up the phone, and the sentence the caller hears. */
function diagnoseTxn(txn: UpiTransaction, customer: Customer, now: Date = new Date()): TxnDiagnosis {
  const party = txn.counterparty.name;
  const amount = spokenRupees(txn.amount);
  const when = spokenWhen(txn.at, now);
  const bank = customer.bank.bank;

  switch (txn.status) {
    case "debited_not_credited":
    case "pending": {
      const tat = reversalTatDays(txn);
      const deadline = txn.reversal?.deadline ?? reversalDeadline(txn).toISOString();
      const late = reversalDaysLate(txn, now);
      const owed = bankCompensationDue(txn, now);
      const dispute = txn.disputeId ? db.getDispute(txn.disputeId) : null;
      const line = [
        txn.status === "pending"
          ? `Pending between ${bank} and ${party}'s bank`
          : `Debited from ${shortAccount(customer)}, not credited to ${party}`,
        late > 0
          ? `${bank} missed the RBI T+${tat} deadline (${formatShortDate(deadline)}) by ${plural(late, "day")}; owes ${formatRupees(owed)} compensation`
          : `RBI T+${tat}: ${bank} must auto-reverse by ${formatLongDate(deadline)}, else ${formatRupees(UPI_DELAY_COMPENSATION_PER_DAY)}/day`,
        dispute
          ? `UDIR dispute ${dispute.id} ${dispute.status.replace(/_/g, " ")}, expected by ${formatShortDate(dispute.expectedBy)}`
          : "No dispute raised yet",
      ].join(" · ");
      const rule =
        late > 0
          ? ` Under RBI rules ${bank} had to return it by ${formatDayMonth(deadline)}; because they're late, ${bank} also owes you ${spokenRupees(owed)} as compensation, paid automatically.`
          : ` Under RBI rules ${bank} must return it to you automatically by ${formatLongDate(deadline)}, and if they're late, ${bank} pays you ${spokenRupees(UPI_DELAY_COMPENSATION_PER_DAY)} for every extra day.`;
      return {
        line,
        say:
          `I can see the ${amount} payment to ${party} ${when}. The money left your ${bank} account but never reached ${party}, so it isn't lost.` +
          rule +
          (dispute
            ? ` A dispute is already raised, reference ${ending(dispute.id)}. ${disputeStatusSay(dispute)}`
            : " I can raise a UPI dispute right now so it's formally tracked."),
        nextStep: !dispute ? "raise_dispute" : new Date(dispute.expectedBy) < now ? "escalate" : undefined,
      };
    }
    case "reversed": {
      const reversedAt = txn.reversal?.reversedAt ?? txn.at;
      const ref = txn.reversal?.rrn;
      return {
        line: `Debited ${formatDateTime(txn.at)}, reversed by ${bank} on ${formatDateTime(reversedAt)}${ref ? ` · reversal ref ${ref}` : ""}`,
        say:
          `Good news: the ${amount} payment to ${party} ${when} did fail, but ${bank} already reversed it on ${formatLongDate(reversedAt)}, so the money is back in your account.` +
          (ref ? ` The reversal reference ends ${lastDigits(ref)}, so you can match it in your bank statement.` : ""),
      };
    }
    case "success":
      return txn.direction === "credit"
        ? {
            line: `Received from ${party} · RRN ${txn.rrn}`,
            say: `The ${amount} from ${party} ${when} reached your account; the UPI reference ends ${lastDigits(txn.rrn)}.`,
          }
        : {
            line: `Bank reports success · RRN ${txn.rrn}`,
            say: `Your bank shows the ${amount} payment to ${party} ${when} as successful, UPI reference ending ${lastDigits(txn.rrn)}. If ${party} says it never reached them, I can flag it for investigation right now.`,
            nextStep: "flag_transaction if the payee says the money never arrived",
          };
    case "flagged": {
      const dispute = txn.disputeId ? db.getDispute(txn.disputeId) : null;
      return {
        line: `Flagged ${formatDateTime(txn.flag?.flaggedAt ?? txn.at)}: bank said success, customer reports no credit${dispute ? ` · dispute ${dispute.id}` : ""}`,
        say:
          `The ${amount} payment to ${party} ${when} is already flagged for investigation` +
          (dispute ? `, dispute reference ending ${lastDigits(dispute.id)}, expected to close by ${formatLongDate(dispute.expectedBy)}.` : "."),
      };
    }
    case "failed":
      return {
        line: "Failed before any debit",
        say: `The ${amount} payment to ${party} ${when} failed before any money was taken, so nothing left your account.`,
      };
  }
}

function recentSummary(txns: UpiTransaction[]): { known: ReturnType<typeof txnBrief>[]; spoken: string } {
  const notable = [...txns.filter((txn) => txn.status !== "success"), ...txns.filter((txn) => txn.status === "success")].slice(0, 4);
  return {
    known: notable.map(txnBrief),
    spoken: notable
      .slice(0, 3)
      .map((txn) => `${spokenRupees(txn.amount)} ${txn.direction === "debit" ? "to" : "from"} ${txn.counterparty.name} ${spokenWhen(txn.at)}`)
      .join("; "),
  };
}

async function getTransaction(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "upi");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const query = txnQuery(params, ["txn_ref", "txn_id"]);

  const momentId = await startStep(call.callRef, {
    kind: "lookup",
    system: "upi",
    title: "Searching UPI transactions",
    detail: describeQuery(query),
  });
  const txns = db.listTransactions(customer.id);
  const txn = findTransaction(txns, query);
  if (!txn) {
    const { known, spoken } = recentSummary(txns);
    db.updateMoment(momentId, { status: "failed", title: "No matching transaction", detail: describeQuery(query) });
    return {
      ok: false,
      known_transactions: known,
      say: `I couldn't find a payment matching that.${spoken ? ` Recent ones on your account: ${spoken}. Is it one of these?` : ""}`,
    };
  }

  const diagnosis = diagnoseTxn(txn, customer);
  db.updateMoment(momentId, {
    status: "ok",
    title: `${formatRupees(txn.amount)} ${txn.direction === "debit" ? "to" : "from"} ${txn.counterparty.name} · ${TXN_STATUS[txn.status]}`,
    detail: diagnosis.line,
    touched: [txn.id],
    data: {
      txnId: txn.id,
      amount: txn.amount,
      status: txn.status,
      rrn: txn.rrn,
      deadline: isStuck(txn) ? (txn.reversal?.deadline ?? reversalDeadline(txn).toISOString()) : undefined,
      reversalRrn: txn.reversal?.rrn,
      disputeId: txn.disputeId,
      diagnosis: diagnosis.line,
    },
  });
  return { ok: true, txn: txnBrief(txn), diagnosis: diagnosis.line, next_step: diagnosis.nextStep, say: diagnosis.say };
}

function disputeDeniedSay(txn: UpiTransaction, customer: Customer): string {
  const party = txn.counterparty.name;
  if (txn.direction === "credit") return "That's a payment you received, so there's nothing to dispute from your side.";
  switch (txn.status) {
    case "reversed":
      return (
        `There's nothing to dispute: ${customer.bank.bank} already reversed the ${spokenRupees(txn.amount)} on ${formatLongDate(txn.reversal?.reversedAt ?? txn.at)}` +
        (txn.reversal?.rrn ? `, reversal reference ${ending(txn.reversal.rrn)}.` : ".")
      );
    case "success":
      return `That payment went through and reached ${party}, so there's nothing to dispute. If they say they didn't get it, they can check with their bank using UPI reference ${ending(txn.rrn)}.`;
    case "failed":
      return "That payment failed before any money was taken, so there's nothing to recover.";
    default:
      return "I can't raise a dispute on this payment right now.";
  }
}

function disputeStatusSay(dispute: Dispute): string {
  return new Date(dispute.expectedBy) < new Date()
    ? `It's past its expected resolution date of ${formatDayMonth(dispute.expectedBy)}, so I can push it to a Paytm specialist now.`
    : `It should close by ${formatLongDate(dispute.expectedBy)}.`;
}

function replayDispute(call: CallRecord, txn: UpiTransaction, dispute: Dispute, customer: Customer, momentId?: string): ToolResult {
  const caught: Partial<Moment> & Pick<Moment, "kind" | "status" | "title"> = {
    kind: "verified",
    system: "upi",
    status: "ok",
    title: "Duplicate dispute request caught",
    detail: `${dispute.id} is already ${dispute.status.replace(/_/g, " ")}; no second dispute raised`,
    touched: [dispute.id, txn.id],
    data: { disputeId: dispute.id, txnId: txn.id, duplicate: true },
  };
  if (momentId) db.updateMoment(momentId, caught);
  else db.recordMoment({ ...caught, callRef: call.callRef });
  return {
    ok: true,
    status: dispute.status,
    duplicate: true,
    dispute_id: dispute.id,
    expected_by: formatLongDate(dispute.expectedBy),
    say:
      `A dispute is already raised for this payment, reference ${ending(dispute.id)}, so I haven't raised a second one. ` +
      `${disputeStatusSay(dispute)} ${customer.bank.bank} will put the ${spokenRupees(txn.amount)} back in your account.`,
  };
}

async function raiseDispute(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "upi");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const txn = findTransaction(db.listTransactions(customer.id), txnQuery(params, ["txn_id", "txn_ref"]));
  if (!txn) {
    return notFound(
      call,
      { kind: "action", system: "upi" },
      "Payment to dispute not found",
      readText(params, "txn_id"),
      "I couldn't find that payment on your account. Could you tell me the amount and who you paid?",
    ).result;
  }

  const existing = txn.disputeId ? db.getDispute(txn.disputeId) : null;
  if (existing) return replayDispute(call, txn, existing, customer);

  const bank = customer.bank.bank;
  const decision = evaluateDispute(txn, bank);
  await showPolicy(call, { id: txn.id, topic: "UPI dispute", amount: txn.amount }, decision);
  if (decision.outcome !== "allow") {
    return { ok: false, status: "denied", txn_id: txn.id, reasons: decision.reasons, say: disputeDeniedSay(txn, customer) };
  }

  const deadline = txn.reversal?.deadline ?? reversalDeadline(txn).toISOString();
  const momentId = await startStep(call.callRef, {
    kind: "action",
    system: "upi",
    title: "Raising a UDIR dispute with NPCI",
    detail: `${formatRupees(txn.amount)} to ${txn.counterparty.name} · RRN ${txn.rrn}`,
    data: { txnId: txn.id, amount: txn.amount },
  });
  const now = new Date();
  const raised = db.raiseDisputeOnce({
    id: `UDIR-${randomDigits(10)}`,
    customerId: customer.id,
    txnId: txn.id,
    channel: "UDIR",
    kind: "debited_not_credited",
    reason: readText(params, "reason") ?? `Debited but not credited to ${txn.counterparty.name}`,
    status: "raised",
    raisedAt: now.toISOString(),
    expectedBy: udirExpectedBy(now).toISOString(),
  });
  if (!raised) {
    db.updateMoment(momentId, { status: "failed", title: "NPCI didn't accept the dispute" });
    return { ok: false, say: "The dispute didn't go through on my side. I'll hand this to a specialist so it isn't lost." };
  }
  if (!raised.created) return replayDispute(call, txn, raised.dispute, customer, momentId);

  const { dispute } = raised;
  db.updateMoment(momentId, {
    status: "ok",
    title: `Dispute ${dispute.id} raised with NPCI`,
    detail: `UDIR · ${bank} to reverse by ${formatShortDate(deadline)} (RBI T+${reversalTatDays(txn)}) · resolution expected by ${formatShortDate(dispute.expectedBy)}`,
    touched: [dispute.id, txn.id],
    data: { disputeId: dispute.id, txnId: txn.id, amount: txn.amount, deadline, expectedBy: dispute.expectedBy },
  });
  logTicket(
    call.callRef,
    { customerId: customer.id, relatedId: txn.id },
    {
      category: "upi",
      subject: `Failed UPI payment to ${txn.counterparty.name}`,
      status: "open",
      note:
        `UDIR dispute ${dispute.id} raised. ${bank} must reverse ${formatRupees(txn.amount)} by ${formatShortDate(deadline)} under RBI TAT; ` +
        `resolution expected by ${formatShortDate(dispute.expectedBy)}. Customer told the bank reverses it, not Paytm.`,
    },
  );

  const verified = await verifyStep(call.callRef, "upi", "Re-reading the dispute from NPCI", () => {
    const stored = db.getDispute(dispute.id);
    const linked = db.getTransaction(txn.id)?.disputeId === dispute.id;
    return stored && linked
      ? {
          passed: true,
          title: "NPCI shows the dispute raised",
          detail: `${stored.id} · ${stored.status} · linked to ${txn.id} · expected by ${formatShortDate(stored.expectedBy)}`,
          touched: [stored.id, txn.id],
        }
      : { passed: false, title: "NPCI doesn't show the dispute", detail: `${dispute.id} is missing or unlinked` };
  });

  const { min, max } = UDIR_RESOLUTION_WORKING_DAYS;
  return {
    ok: true,
    status: "raised",
    dispute_id: dispute.id,
    txn_id: txn.id,
    expected_by: formatLongDate(dispute.expectedBy),
    bank_must_reverse_by: formatLongDate(deadline),
    verified,
    say:
      `Done. I've raised a UPI dispute with NPCI, reference ${ending(dispute.id)}. These usually close in ${min} to ${max} working days, ` +
      `by ${formatLongDate(dispute.expectedBy)} at the latest. ${bank} will put the ${spokenRupees(txn.amount)} back in your account, ` +
      "and you'll get an SMS when it's reversed; you don't need to do anything else.",
  };
}

// The bank's "success" only means the debit cleared; when the payee says nothing arrived, the honest move is to
// mark the payment as under investigation and open a credit-not-received dispute, not to argue with the customer.
async function flagTransaction(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "upi");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const txn = findTransaction(db.listTransactions(customer.id), txnQuery(params, ["txn_id", "txn_ref"]));
  if (!txn) {
    return notFound(
      call,
      { kind: "action", system: "upi" },
      "Payment to flag not found",
      readText(params, "txn_id"),
      "I couldn't find that payment on your account. Could you tell me the amount and who you paid?",
    ).result;
  }

  const reason = readText(params, "reason") ?? `Customer says ${txn.counterparty.name} never received it`;
  const existing = txn.disputeId ? db.getDispute(txn.disputeId) : null;
  if (txn.status === "flagged" && existing) {
    db.recordMoment({
      callRef: call.callRef,
      kind: "action",
      system: "upi",
      title: "Duplicate flag caught",
      detail: `${txn.id} is already flagged · dispute ${existing.id}`,
      status: "ok",
      touched: [txn.id, existing.id],
    });
    return {
      ok: true,
      status: "already_flagged",
      txn_id: txn.id,
      dispute_id: existing.id,
      say: `This payment is already flagged for investigation, dispute reference ending ${lastDigits(existing.id)}, expected to close by ${formatLongDate(existing.expectedBy)}.`,
    };
  }

  const decision = evaluateFlag(txn);
  await showPolicy(call, { id: txn.id, topic: "flag a successful payment", amount: txn.amount }, decision);
  if (decision.outcome === "deny") {
    const failedPayment = txn.status === "debited_not_credited" || txn.status === "pending";
    return {
      ok: false,
      status: "denied",
      txn_id: txn.id,
      reasons: decision.reasons,
      say: failedPayment
        ? "This payment already shows as failed, so instead of flagging it I'll raise a dispute for it."
        : `I can't flag this one: ${decision.reasons[0] ?? "it doesn't qualify"}.`,
    };
  }
  if (decision.outcome === "needs_approval") {
    return escalate({ reason: decision.reasons[0] ?? "Flag outside the window", summary: reason, related_id: txn.id }, call);
  }

  const momentId = await startStep(call.callRef, {
    kind: "action",
    system: "upi",
    title: "Flagging the payment for investigation",
    detail: `${formatRupees(txn.amount)} to ${txn.counterparty.name} · bank says success · RRN ${txn.rrn}`,
    data: { txnId: txn.id, amount: txn.amount },
  });
  const now = new Date();
  const flagged = db.flagTransactionOnce(txn.id, reason, {
    id: `UDIR-${randomDigits(10)}`,
    customerId: customer.id,
    txnId: txn.id,
    channel: "UDIR",
    kind: "credit_not_received",
    reason,
    status: "raised",
    raisedAt: now.toISOString(),
    expectedBy: udirExpectedBy(now).toISOString(),
  });
  if (!flagged) {
    db.updateMoment(momentId, { status: "failed", title: "Couldn't flag the payment" });
    return { ok: false, say: "I couldn't flag that payment on my side. I'll hand this to a specialist so it isn't lost." };
  }

  const { dispute } = flagged;
  db.updateMoment(momentId, {
    status: "ok",
    title: `Payment flagged · dispute ${dispute.id} raised`,
    detail: `Success → Flagged · credit-not-received dispute with NPCI · expected by ${formatShortDate(dispute.expectedBy)}`,
    touched: [txn.id, dispute.id],
    data: { txnId: txn.id, disputeId: dispute.id, amount: txn.amount, previousStatus: "success", expectedBy: dispute.expectedBy },
  });
  logTicket(
    call.callRef,
    { customerId: customer.id, relatedId: txn.id },
    {
      category: "upi",
      subject: `Credit not received by ${txn.counterparty.name}`,
      status: "open",
      note:
        `Bank reported success (RRN ${txn.rrn}) but the customer says ${txn.counterparty.name} never received ${formatRupees(txn.amount)}. ` +
        `Flagged and raised credit-not-received dispute ${dispute.id}; the payee's bank must confirm the credit or the money is reversed.`,
    },
  );

  const verified = await verifyStep(call.callRef, "upi", "Re-reading the payment status", () => {
    const stored = db.getTransaction(txn.id);
    return stored?.status === "flagged" && stored.disputeId === dispute.id
      ? { passed: true, title: "Payment now shows as flagged", detail: `${txn.id} · flagged · dispute ${dispute.id} linked`, touched: [txn.id, dispute.id] }
      : { passed: false, title: "The flag didn't stick", detail: `${txn.id} is ${stored?.status ?? "missing"}` };
  });

  return {
    ok: true,
    status: "flagged",
    txn_id: txn.id,
    dispute_id: dispute.id,
    expected_by: formatLongDate(dispute.expectedBy),
    verified,
    say:
      `Done. I've flagged the ${spokenRupees(txn.amount)} payment to ${txn.counterparty.name} for investigation and raised a credit-not-received dispute, reference ${ending(dispute.id)}. ` +
      `Their bank now has to confirm the credit; if it never reached them, the money comes back to your ${customer.bank.bank} account. ` +
      `Expect an update by ${formatLongDate(dispute.expectedBy)}, and you'll get an SMS.`,
  };
}

// ---------- Consumer: cashback ----------

function locateReward(call: CallRecord, customer: Customer, params: ToolParams): Found<Reward> {
  const rewards = db.listRewards(customer.id);
  const open = rewards.filter((reward) => reward.status === "pending" || reward.status === "failed");
  const ref = readText(params, "reward_id") ?? readText(params, "txn_ref") ?? readText(params, "offer");

  let reward: Reward | undefined;
  if (ref) {
    const id = asId(ref);
    const digits = digitsOf(ref);
    const terms = searchTerms(ref);
    const ordered = [...open, ...rewards.filter((candidate) => !open.includes(candidate))];
    reward =
      ordered.find((candidate) => candidate.id === id || candidate.txnId === id) ??
      (digits.length >= 3
        ? ordered.find((candidate) => {
            const txn = db.getTransaction(candidate.txnId);
            return endsWithDigits(candidate.id, digits) || endsWithDigits(txn?.rrn, digits) || candidate.amount === Number(digits);
          })
        : undefined) ??
      (terms.length > 0
        ? ordered.find((candidate) => {
            const txn = db.getTransaction(candidate.txnId);
            return mentions(`${candidate.offer} ${txn?.counterparty.name ?? ""}`, terms);
          })
        : undefined);
  } else if (open.length === 1) {
    reward = open[0];
  }
  if (reward) return { ok: true, value: reward };

  const choices = open.map((candidate) => {
    const txn = db.getTransaction(candidate.txnId);
    return `${spokenRupees(candidate.amount)} on the ${txn?.counterparty.name ?? candidate.offer} payment`;
  });
  return notFound(
    call,
    { kind: "lookup", system: "rewards" },
    ref ? `No cashback matching "${ref}"` : "Which cashback?",
    open.map((candidate) => `${candidate.id} ${formatRupees(candidate.amount)}`).join(" · ") || undefined,
    choices.length > 0
      ? `You have ${plural(choices.length, "pending cashback")}: ${listing(choices)}. Which one is it?`
      : "I don't see any pending cashback on your account.",
    { pending: open.map((candidate) => ({ reward_id: candidate.id, amount: candidate.amount, offer: candidate.offer })) },
  );
}

function cashbackSubject(reward: Reward): PolicySubject {
  return { id: reward.id, topic: "Cashback credit", amount: reward.amount, touched: [reward.id, reward.txnId] };
}

function cashbackSay(reward: Reward, decision: PolicyDecision): string {
  const txn = db.getTransaction(reward.txnId);
  const what = `${spokenRupees(reward.amount)} cashback on your ${txn?.counterparty.name ?? "payment"}`;
  switch (decision.outcome) {
    case "allow":
      return `The ${what} was due by ${formatDayMonth(reward.promisedBy)} and failed on our side. It qualifies, so I can credit it right now.`;
    case "needs_approval":
      return `The ${what} qualifies, but cashback above ${spokenRupees(CASHBACK_AUTO_LIMIT)} needs a quick one-tap approval from a Paytm specialist. I can request it now; it takes a few seconds.`;
    case "deny":
      return `I can't credit this cashback: ${decision.reasons.join("; ")}.`;
  }
}

async function checkCashback(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "rewards");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const found = locateReward(call, customer, params);
  if (!found.ok) return found.result;
  const reward = found.value;

  const decision = evaluateCashback(reward, db.getTransaction(reward.txnId), customer);
  await showPolicy(call, cashbackSubject(reward), decision);
  return {
    ok: true,
    reward_id: reward.id,
    amount: reward.amount,
    offer: reward.offer,
    status: reward.status,
    promised_by: formatLongDate(reward.promisedBy),
    outcome: decision.outcome,
    reasons: decision.outcome === "deny" ? decision.reasons : undefined,
    say: cashbackSay(reward, decision),
  };
}

function cashbackBrief(reward: Reward, customer: Customer, decision: PolicyDecision): string {
  const txn = db.getTransaction(reward.txnId);
  return [
    `${formatRupees(reward.amount)} cashback · ${reward.offer}`,
    txn ? `${formatRupees(txn.amount)} to ${txn.counterparty.name} on ${formatShortDate(txn.at)} succeeded (${txn.id})` : undefined,
    `Promised by ${formatShortDate(reward.promisedBy)}${reward.failureNote ? `; ${reward.failureNote}` : ""}`,
    `${customer.name}: on Paytm since ${sinceYear(customer)}, ${customer.kyc} KYC, ${standing(customer)}`,
    `Needs you because: ${decision.reasons.join("; ")}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function creditCashback(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "rewards");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const found = locateReward(call, customer, params);
  if (!found.ok) return found.result;
  const reward = found.value;

  const existing = db.findPayout("cashback", reward.id);
  if (existing) return replayPayout(call, existing);

  const decision = evaluateCashback(reward, db.getTransaction(reward.txnId), customer);
  await ensurePolicyShown(call, cashbackSubject(reward), decision);
  if (decision.outcome === "deny") {
    return { ok: false, status: "denied", reward_id: reward.id, reasons: decision.reasons, say: cashbackSay(reward, decision) };
  }
  return movePayout({
    call,
    customer,
    kind: "cashback",
    subjectId: reward.id,
    amount: reward.amount,
    decision,
    reason: readText(params, "reason") ?? `Cashback missed its ${formatShortDate(reward.promisedBy)} credit date`,
    brief: cashbackBrief(reward, customer, decision),
  });
}

// ---------- Loans ----------

function locateLoan(call: CallRecord, customer: Customer, params: ToolParams): Found<Loan> {
  const loans = db.listLoans(customer.id);
  const ref = readText(params, "loan_id");
  let loan: Loan | undefined;
  if (ref) {
    const id = asId(ref);
    const digits = digitsOf(ref);
    const terms = searchTerms(ref);
    loan =
      loans.find((candidate) => candidate.id === id) ??
      (digits.length >= 3 ? loans.find((candidate) => endsWithDigits(candidate.id, digits)) : undefined) ??
      (terms.length > 0 ? loans.find((candidate) => mentions(`${candidate.lender} ${candidate.product}`, terms)) : undefined);
  }
  loan ??= loans.length === 1 ? loans[0] : loans.find((candidate) => findDuplicateDeductions(candidate).length > 0);
  if (loan) return { ok: true, value: loan };

  return notFound(
    call,
    { kind: "lookup", system: "lending" },
    loans.length === 0 ? "No loan on this account" : `No loan matching "${ref ?? ""}"`,
    loans.map((candidate) => `${candidate.id} · ${candidate.lender}`).join(" · ") || undefined,
    loans.length === 0
      ? "I don't see any loan taken through Paytm on this account."
      : `You have loans with ${listing(loans.map((candidate) => candidate.lender))}. Which one is it about?`,
  );
}

function repaymentLabel(loan: Loan): string {
  return loan.repayment.mode === "emi"
    ? `EMI ${formatRupees(loan.repayment.amount)} on the ${loan.repayment.dueDay ?? 5}th`
    : `${formatRupees(loan.repayment.amount)} a day from settlements`;
}

function duplicateLine(duplicate: DuplicateDeduction): string {
  return `${formatRupees(duplicate.amount)} taken twice on ${formatShortDate(duplicate.day)} (${formatTime(duplicate.first.at)} and ${formatTime(duplicate.repeat.at)})`;
}

async function getLoan(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "lending");
  if (!caller.ok) return caller.result;
  const found = locateLoan(call, caller.value, params);
  if (!found.ok) return found.result;
  const loan = found.value;

  const momentId = await startStep(call.callRef, {
    kind: "lookup",
    system: "lending",
    title: `Opening loan ${loan.id} with ${loan.lender}`,
  });
  const duplicates = findDuplicateDeductions(loan);
  const recent = [...loan.deductions].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4);
  const product = loan.product === "personal" ? "Personal loan" : "Merchant loan";
  db.updateMoment(momentId, {
    status: "ok",
    title: `${product} · ${loan.lender}`,
    detail: [
      `${formatRupees(loan.principal)} · ${formatRupees(loan.outstanding)} outstanding · ${repaymentLabel(loan)}`,
      ...duplicates.map(duplicateLine),
    ].join(" · "),
    touched: [loan.id],
    data: {
      loanId: loan.id,
      lender: loan.lender,
      principal: loan.principal,
      outstanding: loan.outstanding,
      repayment: loan.repayment,
      duplicates: duplicates.map((duplicate) => ({ day: duplicate.day, amount: duplicate.amount, rrns: [duplicate.first.rrn, duplicate.repeat.rrn] })),
    },
  });

  const repayment =
    loan.repayment.mode === "emi"
      ? `an EMI of ${spokenRupees(loan.repayment.amount)} on the ${loan.repayment.dueDay ?? 5}th`
      : `${spokenRupees(loan.repayment.amount)} deducted daily from your settlements`;
  const problem = duplicates[0];
  return {
    ok: true,
    loan_id: loan.id,
    lender: loan.lender,
    product: loan.product,
    principal: loan.principal,
    outstanding: loan.outstanding,
    repayment: loan.repayment,
    recent_deductions: recent.map((deduction) => ({ on: formatDateTime(deduction.at), amount: deduction.amount, ref_last4: lastDigits(deduction.rrn) })),
    duplicate_deduction: problem
      ? { on: formatLongDate(problem.day), amount: problem.amount, refs_last4: [lastDigits(problem.first.rrn), lastDigits(problem.repeat.rrn)] }
      : undefined,
    next_step: problem ? "raise_lender_grievance" : undefined,
    say:
      `Your ${loan.product === "personal" ? "personal" : "business"} loan from ${loan.lender} is ${spokenRupees(loan.principal)}, with ${repayment} and ` +
      `${spokenRupees(loan.outstanding)} still to repay.` +
      (problem
        ? ` I can see the ${formatDayMonth(problem.day)} instalment of ${spokenRupees(problem.amount)} was deducted twice, at ${formatTime(problem.first.at)} and again at ${formatTime(problem.repeat.at)}.`
        : ""),
  };
}

async function raiseLenderGrievance(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "lending");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const found = locateLoan(call, customer, params);
  if (!found.ok) return found.result;
  const loan = found.value;
  const officer = loan.grievanceOfficer;
  const routedTo = `${officer.name} <${officer.email}>`;

  const open = db
    .listTickets(customer.id)
    .find((ticket) => ticket.category === "loan" && ticket.relatedId === loan.id && ticket.routedTo && ticket.status !== "resolved");
  if (open) {
    db.recordMoment({
      callRef: call.callRef,
      kind: "verified",
      system: "lending",
      status: "ok",
      title: "Duplicate grievance request caught",
      detail: `${open.id} is already with ${loan.lender}; no second case opened`,
      touched: [open.id, loan.id],
      data: { ticketId: open.id, loanId: loan.id, duplicate: true },
    });
    return {
      ok: true,
      duplicate: true,
      ticket_id: open.id,
      routed_to: loan.lender,
      due_by: formatLongDate(lenderResolutionDue(new Date(open.createdAt))),
      say: `This is already with ${loan.lender}'s grievance officer, ticket ${ending(open.id)}, and they must reply by ${formatLongDate(lenderResolutionDue(new Date(open.createdAt)))}. I haven't opened a second case.`,
    };
  }

  const duplicates = findDuplicateDeductions(loan);
  const now = new Date();
  const due = lenderResolutionDue(now);
  const decision = evaluateLenderGrievance(loan, duplicates, now);
  await showPolicy(call, { id: loan.id, topic: "Lender grievance", amount: duplicates[0]?.amount }, decision);

  const issue = readText(params, "issue") ?? (duplicates.length > 0 ? "EMI deducted twice" : "Loan repayment issue");
  const proof = duplicates[0];
  const momentId = await startStep(call.callRef, {
    kind: "action",
    system: "lending",
    title: `Routing the case to ${loan.lender}'s grievance officer`,
    detail: officer.email,
    data: { loanId: loan.id },
  });
  const brief = [
    `${customer.name} (${customer.kind}, ${customer.city}) · ${loan.id} · ${formatRupees(loan.principal)} ${loan.product} loan via Paytm`,
    `Issue: ${issue}`,
    proof
      ? `${duplicateLine(proof)}, RRN ${proof.first.rrn} and ${proof.repeat.rrn}; refund of ${formatRupees(proof.amount)} requested`
      : undefined,
    `Reply due by ${formatShortDate(due)} (${LENDER_GRIEVANCE_DAYS} days)`,
  ]
    .filter(Boolean)
    .join(" · ");
  const ticket = db.createTicket({
    customerId: customer.id,
    category: "loan",
    relatedId: loan.id,
    subject: `${issue} · ${loan.lender}`,
    status: "open",
    priority: "high",
    routedTo,
    notes: [brief],
  });
  db.updateMoment(momentId, {
    status: "ok",
    title: `Grievance ${ticket.id} sent to ${loan.lender}`,
    detail: `${officer.name} · ${officer.email} · reply due by ${formatShortDate(due)}`,
    touched: [ticket.id, loan.id],
    data: { ticketId: ticket.id, loanId: loan.id, routedTo, dueBy: due.toISOString(), amount: proof?.amount, brief },
  });

  const verified = await verifyStep(call.callRef, "helpdesk", "Re-reading the grievance ticket", () => {
    const stored = db.getTicket(ticket.id);
    return stored?.routedTo === routedTo && stored.status === "open"
      ? {
          passed: true,
          title: `${loan.lender} has the case`,
          detail: `${stored.id} · routed to ${officer.email} · ${LENDER_GRIEVANCE_DAYS}-day clock ends ${formatShortDate(due)}`,
          touched: [stored.id],
        }
      : { passed: false, title: "Grievance ticket isn't routed", detail: stored ? `${stored.id} shows ${stored.status}` : `${ticket.id} is missing` };
  });

  return {
    ok: true,
    ticket_id: ticket.id,
    routed_to: loan.lender,
    due_by: formatLongDate(due),
    verified,
    say:
      `I've sent this to ${loan.lender}'s grievance officer${proof ? " with proof of both deductions" : ""}, ticket ${ending(ticket.id)}. ` +
      `Paytm can't refund the lender's money itself, but ${loan.lender} must resolve it within ${LENDER_GRIEVANCE_DAYS} days, by ${formatLongDate(due)}. ` +
      "If they don't, you can take it to the RBI Ombudsman, and the ticket stays open on our side till then.",
  };
}

// ---------- Merchant: collections and Soundbox ----------

function primaryDevice(customerId: string): DeviceRecord | null {
  const devices = db.listDevices(customerId).filter((device) => device.status !== "returned");
  return devices.find((device) => device.status === "offline") ?? devices[0] ?? null;
}

function unannouncedSinceRestart(device: DeviceRecord): UpiTransaction[] {
  const since = device.lastRestart?.at ?? "";
  return db
    .listTransactions(device.customerId)
    .filter((txn) => txn.deviceId === device.id && txn.announced === false && txn.at > since);
}

async function checkPayments(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "upi", "merchant");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const now = new Date();
  const startOfDay = new Date(`${istDateKey(now)}T00:00:00+05:30`);
  const device = primaryDevice(customer.id);
  const asked = readText(params, "since");
  const parsed = asked ? parseSince(asked, now) : null;
  const offlineSince = device?.status === "offline" ? new Date(device.lastSeen) : null;
  const since = parsed ?? (offlineSince && offlineSince < startOfDay ? offlineSince : startOfDay);
  const label = since.getTime() === startOfDay.getTime() ? "today" : `${spokenWhen(since.toISOString(), now).replace(/^today at /, "")}`;

  const momentId = await startStep(call.callRef, {
    kind: "lookup",
    system: "upi",
    title: `Pulling payments since ${label === "today" ? "midnight" : label}`,
    detail: customer.business?.name,
  });
  const payments = db
    .listTransactions(customer.id)
    .filter((txn) => txn.direction === "credit" && txn.status === "success" && txn.at >= since.toISOString())
    .reverse();
  const total = payments.reduce((sum, txn) => sum + txn.amount, 0);
  const silent = payments.filter((txn) => txn.announced === false);
  const silentTotal = silent.reduce((sum, txn) => sum + txn.amount, 0);
  const lastPayment = payments[payments.length - 1];

  db.updateMoment(momentId, {
    status: "ok",
    title: `${plural(payments.length, "payment")} ${label === "today" ? "today" : `since ${label}`} · ${formatRupees(total)}`,
    detail:
      silent.length > 0
        ? `${silent.length} not announced since ${formatTime(silent[0].at)} · ${formatRupees(silentTotal)} · every one credited`
        : "All announced on the Soundbox · every one credited",
    touched: silent.map((txn) => txn.id),
    data: {
      count: payments.length,
      total,
      unannounced: silent.length,
      unannouncedTotal: silentTotal,
      since: since.toISOString(),
      deviceId: device?.id,
      unannouncedIds: silent.map((txn) => txn.id),
    },
  });

  const offlineLine =
    device?.status === "offline" && silent.length > 0
      ? ` The Soundbox has been offline since ${clockOrDay(device.lastSeen)}, which is why you didn't hear ${silent.length === 1 ? "it" : "them"}.`
      : "";
  return {
    ok: true,
    since: label,
    payments: payments.length,
    total,
    not_announced: {
      count: silent.length,
      total: silentTotal,
      payments: silent.slice(-10).map((txn) => ({ time: formatTime(txn.at), amount: txn.amount, ref_last4: lastDigits(txn.rrn) })),
    },
    device_status: device?.status,
    say:
      payments.length === 0
        ? `I don't see any payments ${label === "today" ? "today" : `since ${label}`} yet.`
        : silent.length > 0
          ? `Your money is safe: ${plural(silent.length, "payment")} totalling ${spokenRupees(silentTotal)} came in since ${formatTime(silent[0].at)} ` +
            `without an announcement, and every one reached your account.${offlineLine} ` +
            `In all, ${plural(payments.length, "payment")} and ${spokenRupees(total)} ${label === "today" ? "today" : `since ${label}`}; ` +
            `the latest was ${spokenRupees(lastPayment.amount)} at ${formatTime(lastPayment.at)}.`
          : `${plural(payments.length, "payment")} and ${spokenRupees(total)} ${label === "today" ? "today" : `since ${label}`}, all announced and credited. ` +
            `The latest was ${spokenRupees(lastPayment.amount)} at ${formatTime(lastPayment.at)}.`,
  };
}

const RETURNED_WORDS = /\b(?:old|purana|purani|returned|return|wapas|pichla|pichhla)\b/;
const CURRENT_WORDS = /\b(?:new|naya|nayi|current|abhi|wala)\b/;

function matchDevice(devices: DeviceRecord[], ref: string): DeviceRecord | undefined {
  const id = asId(ref);
  const digits = digitsOf(ref);
  const text = ref.toLowerCase();
  return (
    devices.find((device) => device.id === id) ??
    (digits.length >= 3 ? devices.find((device) => endsWithDigits(device.id, digits)) : undefined) ??
    (/card/.test(text) ? devices.find((device) => /card/i.test(device.model)) : undefined) ??
    (RETURNED_WORDS.test(text) ? devices.find((device) => device.status === "returned") : undefined) ??
    (CURRENT_WORDS.test(text) ? devices.find((device) => device.status !== "returned") : undefined) ??
    devices.find((device) => mentions(device.model, searchTerms(ref)))
  );
}

function locateDevice(call: CallRecord, customer: Customer, params: ToolParams, purpose: "service" | "rent"): Found<DeviceRecord> {
  const devices = db.listDevices(customer.id);
  const ref = readText(params, "device_id");
  const device = ref
    ? matchDevice(devices, ref)
    : purpose === "rent"
      ? (devices.find((candidate) => candidate.status === "returned" && candidate.rental.billingActive) ??
        devices.find((candidate) => candidate.status === "returned") ??
        devices[0])
      : (primaryDevice(customer.id) ?? undefined);
  if (device) return { ok: true, value: device };

  return notFound(
    call,
    { kind: "lookup", system: "devices" },
    ref ? `No device matching "${ref}"` : "No Soundbox on this account",
    devices.map((candidate) => `${candidate.id} ${candidate.model} (${candidate.status})`).join(" · ") || undefined,
    devices.length > 0
      ? `I couldn't tell which device you mean. On your account: ${listing(devices.map((candidate) => `the ${candidate.model} ${ending(candidate.id)}`))}.`
      : "I don't see a Soundbox on this account.",
  );
}

function deviceLabel(device: DeviceRecord): string {
  return `${device.model.replace(/^Paytm /, "")} ••${device.id.slice(-4)}`;
}

async function diagnoseDevice(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "devices", "merchant");
  if (!caller.ok) return caller.result;
  const found = locateDevice(call, caller.value, params, "service");
  if (!found.ok) return found.result;
  const device = found.value;

  const momentId = await startStep(call.callRef, {
    kind: "lookup",
    system: "devices",
    title: `Reading ${deviceLabel(device)} remotely`,
    detail: device.id,
  });
  const { health } = device;
  const behind = health.firmware !== health.latestFirmware;
  const silent = unannouncedSinceRestart(device);
  const stateLine =
    device.status === "offline"
      ? `offline since ${clockOrDay(device.lastSeen)}`
      : device.status === "returned"
        ? `returned ${device.rental.returnedAt ? formatShortDate(device.rental.returnedAt) : ""}`.trim()
        : "online";
  const cause =
    device.status === "returned"
      ? "Device was returned"
      : device.status === "offline"
        ? [
            health.signal !== "good" ? `${health.signal} ${health.sim} signal dropped the connection` : "Lost its network connection",
            behind ? `old firmware ${health.firmware} didn't reconnect on its own` : undefined,
          ]
            .filter(Boolean)
            .join("; ")
        : silent.length > 0
          ? "Online but missed announcements"
          : "Healthy";
  db.updateMoment(momentId, {
    status: "ok",
    title: `${deviceLabel(device)} · ${stateLine}`,
    detail: [
      `Signal ${health.signal}`,
      `firmware ${health.firmware}${behind ? ` (latest ${health.latestFirmware})` : ""}`,
      `battery ${health.battery}%`,
      health.sim,
      silent.length > 0 ? `${plural(silent.length, "payment")} not announced` : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
    touched: [device.id],
    data: {
      deviceId: device.id,
      status: device.status,
      lastSeen: device.lastSeen,
      signal: health.signal,
      battery: health.battery,
      firmware: health.firmware,
      latestFirmware: health.latestFirmware,
      sim: health.sim,
      unannounced: silent.length,
      cause,
    },
  });

  const steps = device.status === "returned" ? [] : fixPlan(device, "all");
  return {
    ok: true,
    device_id: device.id,
    model: device.model,
    status: device.status,
    offline_since: device.status === "offline" ? clockOrDay(device.lastSeen) : undefined,
    signal: health.signal,
    battery: health.battery,
    firmware: health.firmware,
    latest_firmware: health.latestFirmware,
    likely_cause: cause,
    next_steps: steps,
    say:
      device.status === "returned"
        ? `That ${device.model} was returned${device.rental.returnedAt ? ` on ${formatDayMonth(device.rental.returnedAt)}` : ""}, so it isn't in service.`
        : device.status === "offline"
          ? `Your Soundbox has been offline since ${clockOrDay(device.lastSeen)}. The ${health.sim} signal is ${health.signal}` +
            `${behind ? ` and it's on old software, version ${health.firmware}` : ""}. ` +
            `I can restart it remotely${behind ? " and update the software" : ""} right now; it takes about a minute.`
          : silent.length > 0
            ? `Your Soundbox is online but missed ${plural(silent.length, "announcement")}. A remote restart usually fixes that; shall I do it?`
            : `Your Soundbox is online and healthy: good signal, battery ${health.battery} percent${behind ? `, though a software update to ${health.latestFirmware} is available` : ""}.`,
  };
}

type FixAction = Exclude<DeviceAction, "replacement">;

function parseFixAction(text: string | undefined): FixAction | "all" | undefined {
  if (!text) return undefined;
  const value = text.toLowerCase();
  if (/\b(?:all|everything|sab|full|complete|fix)\b/.test(value)) return "all";
  if (/test|announce|awaa?z|sound check|bol/.test(value)) return "test_announcement";
  if (/firm|update|software|upgrade/.test(value)) return "firmware_update";
  if (/restart|reboot|reset|on.?off|band/.test(value)) return "restart";
  return undefined;
}

/** The remote fixes that apply right now, in the order a field engineer would try them. */
function fixPlan(device: DeviceRecord, requested: FixAction | "all" | undefined): FixAction[] {
  const needsRestart = device.status === "offline" || unannouncedSinceRestart(device).length > 0;
  const plan: FixAction[] = [
    ...(needsRestart ? (["restart"] as const) : []),
    ...(device.health.firmware !== device.health.latestFirmware ? (["firmware_update"] as const) : []),
    "test_announcement",
  ];
  if (requested === "all") return plan;
  return [requested ?? plan[0]];
}

const FIX_LABEL: Record<FixAction, string> = {
  restart: "Restart",
  firmware_update: "Firmware update",
  test_announcement: "Test announcement",
};

function deviceDeniedSay(device: DeviceRecord, action: FixAction): string {
  if (device.status === "returned") return `That ${device.model} was returned, so I can't work on it remotely.`;
  if (action === "restart") return "It's already online and announcing payments, so it doesn't need a restart.";
  if (device.status !== "online") return "It's offline right now, so it needs a restart first.";
  return `It's already on the latest software, version ${device.health.latestFirmware}.`;
}

function applyFix(device: DeviceRecord, action: FixAction): { title: string; detail: string } {
  const now = new Date().toISOString();
  switch (action) {
    case "restart":
      if (device.fault) {
        db.updateDevice(device.id, { lastRestart: { at: now, ok: false } });
        return { title: "Restart command sent", detail: "No heartbeat after the reboot" };
      }
      db.updateDevice(device.id, {
        status: "online",
        lastSeen: now,
        lastRestart: { at: now, ok: true },
        health: { ...device.health, signal: "good" },
      });
      return { title: "Restart command delivered", detail: `Rebooted and re-registered on ${device.health.sim}` };
    case "firmware_update":
      db.updateDevice(device.id, { lastSeen: now, health: { ...device.health, firmware: device.health.latestFirmware } });
      return { title: `Firmware ${device.health.latestFirmware} installed`, detail: `${device.health.firmware} → ${device.health.latestFirmware} over the air` };
    case "test_announcement":
      db.updateDevice(device.id, { lastSeen: now, lastAnnouncement: { at: now, amount: 1 } });
      return { title: "₹1 test payment sent to the Soundbox", detail: `Announcement requested at volume ${device.health.volume}%` };
  }
}

function verifyFix(deviceId: string, action: FixAction, startedAt: string): Verification {
  const device = db.getDevice(deviceId);
  if (!device) return { passed: false, title: "Device is missing", detail: deviceId };
  const label = deviceLabel(device);
  switch (action) {
    case "restart":
      return device.status === "online" && device.lastRestart?.ok && device.lastRestart.at >= startedAt
        ? {
            passed: true,
            title: "Soundbox back online",
            detail: `${label} · online · signal ${device.health.signal} · heartbeat ${formatTime(device.lastSeen)}`,
            touched: [device.id],
          }
        : { passed: false, title: "Soundbox didn't come back online", detail: `${label} · no heartbeat since ${formatDateTime(device.lastSeen)}` };
    case "firmware_update":
      return device.health.firmware === device.health.latestFirmware
        ? { passed: true, title: `Firmware ${device.health.firmware} confirmed`, detail: `${label} reports the latest release`, touched: [device.id] }
        : { passed: false, title: "Firmware didn't update", detail: `${label} still on ${device.health.firmware}` };
    case "test_announcement": {
      const played = device.lastAnnouncement;
      return device.status === "online" && played && played.at >= startedAt
        ? {
            passed: true,
            title: "₹1 test announcement played",
            detail: `${label} confirmed playback at ${formatTime(played.at)} · volume ${device.health.volume}%`,
            touched: [device.id],
          }
        : { passed: false, title: "No playback confirmation", detail: `${label} didn't acknowledge the test` };
    }
  }
}

const FIX_SAID: Record<FixAction, (device: DeviceRecord) => string> = {
  restart: () => "I restarted your Soundbox remotely and it's back online with a good signal.",
  firmware_update: (device) => `It's now on the latest software, version ${device.health.latestFirmware}.`,
  test_announcement: () => "It just announced a 1 rupee test payment. Did you hear it at the shop?",
};

interface FixOutcome {
  action: FixAction;
  ok: boolean;
  say: string;
}

async function runFix(call: CallRecord, deviceId: string, action: FixAction): Promise<FixOutcome> {
  const device = db.getDevice(deviceId);
  if (!device) throw new Error(`Device ${deviceId} disappeared`);
  const decision = evaluateDeviceAction(device, action, unannouncedSinceRestart(device).length);
  if (decision.outcome !== "allow") {
    db.recordMoment({
      callRef: call.callRef,
      kind: "action",
      system: "devices",
      status: "blocked",
      title: `${FIX_LABEL[action]} not done`,
      detail: decision.reasons.join(" · "),
      touched: [device.id],
      data: { deviceId: device.id, action, outcome: decision.outcome, checks: decision.checks, reasons: decision.reasons },
    });
    return { action, ok: false, say: deviceDeniedSay(device, action) };
  }

  const startedAt = new Date().toISOString();
  const momentId = await startStep(call.callRef, {
    kind: "action",
    system: "devices",
    title:
      action === "restart"
        ? `Restarting ${deviceLabel(device)} remotely`
        : action === "firmware_update"
          ? `Pushing firmware ${device.health.latestFirmware}`
          : "Playing a ₹1 test announcement",
    detail: decision.reasons.join(" · "),
    data: { deviceId: device.id, action, checks: decision.checks },
  });
  const applied = applyFix(device, action);
  db.updateMoment(momentId, { status: "ok", title: applied.title, detail: applied.detail, touched: [device.id] });

  const verifyTitle =
    action === "restart" ? "Waiting for the device heartbeat" : action === "firmware_update" ? "Reading the firmware version" : "Listening for playback confirmation";
  const verified = await verifyStep(call.callRef, "devices", verifyTitle, () => verifyFix(device.id, action, startedAt));
  const after = db.getDevice(device.id) ?? device;
  return {
    action,
    ok: verified,
    say: verified
      ? FIX_SAID[action](after)
      : action === "restart"
        ? "I restarted it remotely, but it didn't come back online, so it looks like a hardware fault. I can book a free replacement."
        : "That didn't go through on the device. I can try once more, or book a replacement.",
  };
}

async function fixDevice(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "devices", "merchant");
  if (!caller.ok) return caller.result;
  const found = locateDevice(call, caller.value, params, "service");
  if (!found.ok) return found.result;
  const device = found.value;

  const steps = fixPlan(device, parseFixAction(readText(params, "action")));
  const outcomes: FixOutcome[] = [];
  for (const action of steps) {
    const outcome = await runFix(call, device.id, action);
    outcomes.push(outcome);
    if (!outcome.ok) break;
  }

  const after = db.getDevice(device.id) ?? device;
  const failedRestart = outcomes.some((outcome) => outcome.action === "restart" && !outcome.ok && after.lastRestart?.ok === false);
  const remaining = after.status === "returned" ? [] : fixPlan(after, "all").filter((action) => !outcomes.some((done) => done.ok && done.action === action));
  return {
    ok: outcomes.every((outcome) => outcome.ok),
    device_id: device.id,
    status: after.status,
    firmware: after.health.firmware,
    steps: outcomes.map(({ action, ok }) => ({ action, ok })),
    next_step: failedRestart ? "book_replacement" : remaining[0],
    say: outcomes.map((outcome) => outcome.say).join(" "),
  };
}

async function bookReplacement(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "devices", "merchant");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const found = locateDevice(call, customer, params, "service");
  if (!found.ok) return found.result;
  const device = found.value;

  const booked = db
    .listTickets(customer.id)
    .find((ticket) => ticket.category === "device" && ticket.relatedId === device.id && ticket.subject.startsWith("Replacement") && ticket.status !== "resolved");
  if (booked) {
    db.recordMoment({
      callRef: call.callRef,
      kind: "verified",
      system: "devices",
      status: "ok",
      title: "Duplicate replacement request caught",
      detail: `${booked.id} already booked for ${device.id}; no second unit sent`,
      touched: [booked.id, device.id],
      data: { ticketId: booked.id, deviceId: device.id, duplicate: true },
    });
    return {
      ok: true,
      duplicate: true,
      ticket_id: booked.id,
      say: `A replacement is already booked for this Soundbox, ticket ${ending(booked.id)}, so I haven't booked a second one.`,
    };
  }

  const decision = evaluateDeviceAction(device, "replacement", unannouncedSinceRestart(device).length);
  await showPolicy(call, { id: device.id, topic: "Soundbox replacement" }, decision);
  if (decision.outcome !== "allow") {
    return {
      ok: false,
      status: "denied",
      device_id: device.id,
      reasons: decision.reasons,
      next_step: device.lastRestart ? undefined : "fix_device",
      say:
        device.status === "returned"
          ? `That ${device.model} was already returned.`
          : device.lastRestart?.ok
            ? "The remote restart fixed it, so you don't need a replacement. If it goes quiet again, call us and we'll swap it."
            : "Let me first try restarting it remotely; a replacement is booked only if that doesn't work.",
    };
  }

  const eta = addBusinessDays(new Date(), REPLACEMENT_DELIVERY_WORKING_DAYS);
  const momentId = await startStep(call.callRef, {
    kind: "action",
    system: "devices",
    title: "Booking a replacement Soundbox",
    detail: `${deviceLabel(device)} · ${customer.business?.address ?? customer.city}`,
    data: { deviceId: device.id },
  });
  const ticket = db.createTicket({
    customerId: customer.id,
    category: "device",
    relatedId: device.id,
    subject: `Replacement for ${device.model} ${device.id}`,
    status: "open",
    priority: "high",
    notes: [
      `Remote restart failed${device.fault ? ` (${device.fault})` : ""}. Replacement ${device.model} dispatched; field agent delivers ` +
        `and collects ${device.id} by ${formatShortDate(eta)}. No charge under the rental plan.`,
    ],
  });
  db.updateMoment(momentId, {
    status: "ok",
    title: `Replacement booked · ${ticket.id}`,
    detail: `Delivery by ${formatShortDate(eta)} · old unit collected on the same visit · no charge`,
    touched: [ticket.id, device.id],
    data: { ticketId: ticket.id, deviceId: device.id, deliveryBy: eta.toISOString() },
  });
  const verified = await verifyStep(call.callRef, "helpdesk", "Re-reading the replacement order", () => {
    const stored = db.getTicket(ticket.id);
    return stored?.status === "open"
      ? { passed: true, title: "Replacement order confirmed", detail: `${stored.id} · ${stored.subject}`, touched: [stored.id] }
      : { passed: false, title: "Replacement order missing", detail: ticket.id };
  });

  return {
    ok: true,
    ticket_id: ticket.id,
    delivery_by: formatLongDate(eta),
    verified,
    say:
      `I've booked a free replacement Soundbox, ticket ${ending(ticket.id)}. Our field agent will bring it by ${formatLongDate(eta)} ` +
      "and take the old one back; there's nothing extra to pay.",
  };
}

// ---------- Merchant: settlements ----------

function locateSettlement(call: CallRecord, customer: Customer, params: ToolParams): Found<Settlement> {
  const settlements = db.listSettlements(customer.id);
  const ref = readText(params, "settlement_id");
  const dateText = readText(params, "date");

  const id = ref ? asId(ref) : "";
  const digits = ref ? digitsOf(ref) : "";
  const byRef = ref
    ? (settlements.find((settlement) => settlement.id === id) ??
      (digits.length >= 3
        ? settlements.find((settlement) => endsWithDigits(settlement.id, digits) || endsWithDigits(settlement.utr, digits))
        : undefined))
    : undefined;
  const dayText = dateText ?? (byRef ? undefined : ref);
  const day = dayText ? parsePastDate(dayText) : null;
  // "Aaj ka settlement nahi aaya" means the one due today, which settles yesterday's collections.
  const byDay = day
    ? (settlements.find((settlement) => settlement.forDate === day) ??
      settlements.find((settlement) => shiftDateKey(settlement.forDate, 1) === day))
    : undefined;
  const fallback = !ref && !dateText ? (settlements.find((settlement) => settlement.status !== "settled") ?? settlements[0]) : undefined;
  const settlement = byRef ?? byDay ?? fallback;
  if (settlement) return { ok: true, value: settlement };

  const latest = settlements[0];
  return notFound(
    call,
    { kind: "lookup", system: "settlements" },
    `No settlement for "${dateText ?? ref ?? ""}"`,
    latest ? `Latest: ${latest.id} for ${formatShortDate(latest.forDate)} · ${latest.status}` : undefined,
    latest
      ? `I couldn't find ${digits.length >= 3 ? "that settlement on your account" : "a settlement for that day"}. The latest one is for ${formatDayMonth(latest.forDate)}: ${spokenRupees(latest.amount)}, ${latest.status.replace(/_/g, " ")}.`
      : "I don't see any settlements on this account yet.",
  );
}

function settlementSay(settlement: Settlement, customer: Customer): string {
  const amount = spokenRupees(settlement.amount);
  const day = formatDayMonth(settlement.forDate);
  const account = accountOf(customer, settlement.bankLast4);
  if (settlement.status === "settled") {
    return `The ${amount} settlement for ${day} reached your ${account}${settlement.settledAt ? ` on ${formatDayMonth(settlement.settledAt)} at ${formatTime(settlement.settledAt)}` : ""}${settlement.utr ? `, UTR ${ending(settlement.utr)}` : ""}.`;
  }
  if (settlement.status === "processing") return `The ${amount} settlement for ${day} is on its way to your ${account} right now.`;
  if (settlementNeedsReview(settlement)) {
    return `The ${amount} settlement for ${day} is on a security review hold, so I can't release it on a call. A Paytm specialist needs to look at it, and I can hand it over now.`;
  }
  if (settlementNeedsNewBank(settlement)) {
    return (
      `The ${amount} settlement for ${day} couldn't be credited because your ${account} is ${customer.bank.status === "frozen" ? "frozen" : "closed"}. ` +
      "For your safety, the bank account can only be changed in the Paytm for Business app with verification, never on a call. I can send you a secure link to do that now."
    );
  }
  return (
    `The ${amount} settlement for ${day}, for ${plural(settlement.txnCount, "payment")}, didn't reach your ${account} because ${customer.bank.bank}'s server timed out. ` +
    "The money is safe with Paytm, and I can send it again right now."
  );
}

async function getSettlement(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "settlements", "merchant");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const found = locateSettlement(call, customer, params);
  if (!found.ok) return found.result;
  const settlement = found.value;

  const momentId = await startStep(call.callRef, {
    kind: "lookup",
    system: "settlements",
    title: `Opening the settlement for ${formatShortDate(settlement.forDate)}`,
    detail: settlement.id,
  });
  db.updateMoment(momentId, {
    status: "ok",
    title: `Settlement ${formatShortDate(settlement.forDate)} · ${formatRupees(settlement.amount)} · ${settlement.status.replace(/_/g, " ")}`,
    detail: [
      `${plural(settlement.txnCount, "payment")}`,
      shortAccount(customer, settlement.bankLast4),
      settlement.failure ? `${settlement.failure.code}: ${settlement.failure.note}` : undefined,
      settlement.utr ? `UTR ${settlement.utr}` : undefined,
      `${settlement.retries} retr${settlement.retries === 1 ? "y" : "ies"}`,
    ]
      .filter(Boolean)
      .join(" · "),
    touched: [settlement.id],
    data: {
      settlementId: settlement.id,
      forDate: settlement.forDate,
      amount: settlement.amount,
      status: settlement.status,
      failure: settlement.failure,
      retries: settlement.retries,
      utr: settlement.utr,
    },
  });

  const recent = db
    .listSettlements(customer.id)
    .filter((candidate) => candidate.id !== settlement.id)
    .slice(0, 3)
    .map((candidate) => ({ for: formatShortDate(candidate.forDate), amount: candidate.amount, status: candidate.status }));
  const nextStep =
    settlement.status !== "failed" && !settlementNeedsReview(settlement)
      ? undefined
      : settlementNeedsReview(settlement)
        ? "escalate"
        : settlementNeedsNewBank(settlement)
          ? "send_bank_update_link"
          : "retry_settlement";
  return {
    ok: true,
    settlement_id: settlement.id,
    for_date: formatLongDate(settlement.forDate),
    amount: settlement.amount,
    payments: settlement.txnCount,
    status: settlement.status,
    failure_code: settlement.failure?.code,
    retries: settlement.retries,
    bank: shortAccount(customer, settlement.bankLast4),
    utr_last4: settlement.utr ? lastDigits(settlement.utr) : undefined,
    recent,
    next_step: nextStep,
    say: settlementSay(settlement, customer),
  };
}

function settlementBrief(settlement: Settlement, customer: Customer, decision: PolicyDecision): string {
  return [
    `${formatRupees(settlement.amount)} settlement retry · ${formatShortDate(settlement.forDate)} (${settlement.id}), ${plural(settlement.txnCount, "payment")}`,
    settlement.failure ? `${settlement.failure.code}: ${settlement.failure.note}` : undefined,
    `${customer.business?.name ?? customer.name} (${customer.name}), merchant since ${sinceYear(customer)}, ${standing(customer)}`,
    `Needs you because: ${decision.reasons.join("; ")}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function retrySettlement(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "settlements", "merchant");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const found = locateSettlement(call, customer, params);
  if (!found.ok) return found.result;
  const settlement = found.value;

  const existing = db.findPayout("settlement_retry", settlement.id);
  if (existing) return replayPayout(call, existing);

  const decision = evaluateSettlementRetry(settlement);
  await showPolicy(call, { id: settlement.id, topic: "Settlement retry", amount: settlement.amount }, decision);
  if (decision.outcome === "deny") {
    const base = { ok: false, status: "denied", settlement_id: settlement.id, reasons: decision.reasons };
    if (settlementNeedsReview(settlement)) {
      const ticket = openEscalation(call, customer, {
        reason: "Settlement on risk hold",
        summary: `${formatRupees(settlement.amount)} for ${formatShortDate(settlement.forDate)} held: ${settlement.failure?.note ?? "risk review"}. Merchant asked for it on a call.`,
        relatedId: settlement.id,
        category: "settlement",
      });
      return {
        ...base,
        ticket_id: ticket.id,
        say:
          `This settlement is on a security review hold, so I can't release it on a call. I've passed it to a Paytm specialist, ticket ${ending(ticket.id)}, ` +
          `and they'll call you within ${ESCALATION_CALLBACK_HOURS} hours.`,
      };
    }
    if (settlementNeedsNewBank(settlement)) return { ...base, next_step: "send_bank_update_link", say: settlementSay(settlement, customer) };
    return { ...base, say: settlement.status === "settled" ? settlementSay(settlement, customer) : `I can't retry this settlement: ${decision.reasons.join("; ")}.` };
  }

  return movePayout({
    call,
    customer,
    kind: "settlement_retry",
    subjectId: settlement.id,
    amount: settlement.amount,
    decision,
    reason: readText(params, "reason") ?? `${settlement.failure?.code ?? "Failed"} on ${formatShortDate(settlement.forDate)}`,
    brief: settlementBrief(settlement, customer, decision),
  });
}

// Where settlements land is the single most valuable thing a fraudster on the phone can ask to change, so it is
// changed only in the app, behind the merchant's own login and a penny-drop check, and never by Closr.
async function sendBankUpdateLink(_params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "crm", "merchant");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const stuck = db.listSettlements(customer.id).find((settlement) => settlement.status === "failed" && settlementNeedsNewBank(settlement));

  const momentId = await startStep(call.callRef, {
    kind: "action",
    system: "crm",
    title: "Sending a secure bank-update link",
    detail: "Paytm for Business app · SMS",
  });
  db.updateMoment(momentId, {
    status: "ok",
    title: "Secure bank-update link sent",
    detail: `App notification + SMS to ••${lastDigits(customer.phone)} · expires in 24 hours · bank details not changed on this call`,
    touched: [customer.id, ...(stuck ? [stuck.id] : [])],
    data: { channels: ["app", "sms"], expiresInHours: 24, bankChanged: false, settlementId: stuck?.id },
  });
  logTicket(
    call.callRef,
    { customerId: customer.id, relatedId: stuck?.id },
    {
      category: "settlement",
      subject: stuck ? `Settlement for ${formatShortDate(stuck.forDate)} failed: bank account ${customer.bank.status}` : "Settlement bank account update",
      status: "open",
      note: "Secure bank-update link sent in the Paytm for Business app; bank details are never changed on a call.",
    },
  );
  return {
    ok: true,
    sent_to: ["app", "sms"],
    expires_in_hours: 24,
    bank_changed: false,
    say:
      "I've sent a secure link to your Paytm for Business app and by SMS; it's valid for 24 hours. Add the new account there and it's verified with a 1 rupee penny-drop. " +
      `I can't change bank details on a call; that's to protect your money.${stuck ? " Once the new account is verified, the failed settlement can be sent to it." : ""}`,
  };
}

// ---------- Merchant: device rent ----------

function rentSubject(device: DeviceRecord, amount: number, chargeIds: string[]): PolicySubject {
  return { id: device.id, topic: "Rent refund", amount, touched: [device.id, ...chargeIds] };
}

function rentSay(device: DeviceRecord, refundable: { period: string; amount: number }[], amount: number, decision: PolicyDecision): string {
  const months = listing(refundable.map((charge) => formatMonth(charge.period).split(" ")[0]));
  const each = refundable.length > 1 && refundable.every((charge) => charge.amount === refundable[0].amount);
  const pickup = device.rental.pickupRef ? `, pickup reference ${ending(device.rental.pickupRef)}` : "";
  const facts =
    `The ${device.model} was picked up on ${device.rental.returnedAt ? formatDayMonth(device.rental.returnedAt) : "its return date"}${pickup}, ` +
    `but rent was still charged for ${months}${each ? `, ${spokenRupees(refundable[0].amount)} each` : ""}: ${spokenRupees(amount)} in total.`;
  switch (decision.outcome) {
    case "allow":
      return `You're right. ${facts} I can refund it and stop the billing right now.`;
    case "needs_approval":
      return `You're right. ${facts} I can refund it and stop the billing; because it's above ${spokenRupees(RENT_REFUND_AUTO_LIMIT)}, a Paytm specialist approves it with one tap.`;
    case "deny":
      return device.status !== "returned"
        ? `The ${device.model} is still with you, so its ${spokenRupees(device.rental.monthly)} monthly rent is correct.`
        : `I don't see any rent to refund: ${decision.reasons.join("; ")}.`;
  }
}

async function checkRent(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "billing", "merchant");
  if (!caller.ok) return caller.result;
  const found = locateDevice(call, caller.value, params, "rent");
  if (!found.ok) return found.result;
  const device = found.value;

  const momentId = await startStep(call.callRef, {
    kind: "lookup",
    system: "billing",
    title: `Pulling rent on ${deviceLabel(device)}`,
    detail: device.id,
  });
  const charges = db.listRentalCharges(device.id);
  const late = chargesAfterReturn(device, charges);
  const { returnedAt, pickupRef, billingActive } = device.rental;
  db.updateMoment(momentId, {
    status: "ok",
    title: `Rent on ${deviceLabel(device)} · ${formatRupees(device.rental.monthly)}/month`,
    detail: [
      returnedAt ? `Returned ${formatShortDate(returnedAt)}${pickupRef ? ` · pickup ${pickupRef}` : ""}` : `In use since ${formatShortDate(device.rental.startedAt)}`,
      `billing ${billingActive ? "active" : "stopped"}`,
      late.length > 0
        ? `after return: ${late.map((charge) => `${formatMonth(charge.period)} ${formatRupees(charge.amount)} (${charge.status})`).join(", ")}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
    touched: [device.id, ...late.map((charge) => charge.id)],
    data: {
      deviceId: device.id,
      returnedAt,
      pickupRef,
      billingActive,
      chargesAfterReturn: late.map((charge) => ({ id: charge.id, period: charge.period, amount: charge.amount, status: charge.status })),
    },
  });

  const { decision, refundable, amount } = evaluateRentRefund(device, charges);
  await showPolicy(call, rentSubject(device, amount, refundable.map((charge) => charge.id)), decision);
  return {
    ok: true,
    device_id: device.id,
    model: device.model,
    returned_on: returnedAt ? formatLongDate(returnedAt) : undefined,
    pickup_ref_last4: pickupRef ? lastDigits(pickupRef) : undefined,
    billing_active: billingActive,
    charged_after_return: late.map((charge) => ({ month: formatMonth(charge.period), amount: charge.amount, status: charge.status })),
    refundable: amount,
    outcome: decision.outcome,
    say: rentSay(device, refundable, amount, decision),
  };
}

function rentBrief(device: DeviceRecord, customer: Customer, refundable: { period: string }[], amount: number, decision: PolicyDecision): string {
  return [
    `${formatRupees(amount)} rent refund · ${device.model} ${device.id}`,
    device.rental.returnedAt
      ? `Returned ${formatShortDate(device.rental.returnedAt)} (pickup ${device.rental.pickupRef ?? "no ref"}); charged ${refundable.map((charge) => formatMonth(charge.period)).join(" + ")} after return`
      : undefined,
    `${customer.business?.name ?? customer.name} (${customer.name}), merchant since ${sinceYear(customer)}, ${standing(customer)}`,
    `Needs you because: ${decision.reasons.join("; ")}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function refundRent(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const caller = requireCaller(call, "billing", "merchant");
  if (!caller.ok) return caller.result;
  const customer = caller.value;
  const found = locateDevice(call, customer, params, "rent");
  if (!found.ok) return found.result;
  const device = found.value;

  const existing = db.findPayout("rent_refund", device.id);
  if (existing) return replayPayout(call, existing);

  const { decision, refundable, amount } = evaluateRentRefund(device, db.listRentalCharges(device.id));
  await ensurePolicyShown(call, rentSubject(device, amount, refundable.map((charge) => charge.id)), decision);
  if (decision.outcome === "deny") {
    return { ok: false, status: "denied", device_id: device.id, reasons: decision.reasons, say: rentSay(device, refundable, amount, decision) };
  }
  return movePayout({
    call,
    customer,
    kind: "rent_refund",
    subjectId: device.id,
    amount,
    decision,
    reason: readText(params, "reason") ?? `Rent billed after the ${formatShortDate(device.rental.returnedAt ?? device.lastSeen)} return`,
    brief: rentBrief(device, customer, refundable, amount, decision),
  });
}

// ---------- Profile ----------

interface Profile {
  detail: string;
  data: Record<string, unknown>;
  result: Record<string, unknown>;
  say: string;
}

function consumerProfile(customer: Customer, now: Date): Profile {
  const txns = db.listTransactions(customer.id);
  const stuck = txns.filter(isStuck);
  const reversed = txns.filter(
    (txn) => txn.status === "reversed" && calendarDaysBetween(txn.reversal?.reversedAt ?? txn.at, now) <= 7,
  );
  const rewards = db.listRewards(customer.id).filter((reward) => reward.status === "pending" || reward.status === "failed");
  const loans = db.listLoans(customer.id);

  const attention = [
    ...stuck.map((txn) => ({ type: "stuck_payment", txn_id: txn.id, amount: txn.amount, to: txn.counterparty.name, when: formatDateTime(txn.at), status: TXN_STATUS[txn.status] })),
    ...reversed.map((txn) => ({ type: "reversed_payment", txn_id: txn.id, amount: txn.amount, to: txn.counterparty.name, when: formatDateTime(txn.at) })),
    ...rewards.map((reward) => ({ type: "pending_cashback", reward_id: reward.id, amount: reward.amount, offer: reward.offer, promised_by: formatShortDate(reward.promisedBy) })),
  ];

  const said: string[] = [];
  const first = stuck[0];
  if (first) {
    said.push(
      `A ${spokenRupees(first.amount)} payment to ${first.counterparty.name} ${spokenWhen(first.at, now)} was debited but hasn't reached them` +
        `${stuck.length > 1 ? `, plus ${plural(stuck.length - 1, "more stuck payment")}` : ""}.`,
    );
  }
  if (reversed[0]) said.push(`A ${spokenRupees(reversed[0].amount)} payment to ${reversed[0].counterparty.name} failed and was already reversed.`);
  if (rewards.length > 0) said.push(`${plural(rewards.length, "cashback")} pending.`);
  if (loans[0]) said.push(`A ${loans[0].product} loan from ${loans[0].lender}.`);

  return {
    detail: [`Consumer`, customer.city, `${customer.kyc} KYC`, customer.upiHandle, shortAccount(customer), `on Paytm since ${sinceYear(customer)}`].join(" · "),
    data: { txnIds: stuck.map((txn) => txn.id), rewardIds: rewards.map((reward) => reward.id), loanIds: loans.map((loan) => loan.id) },
    result: {
      customer: {
        id: customer.id,
        name: customer.name,
        city: customer.city,
        language: customer.language,
        kyc: customer.kyc,
        upi_handle: customer.upiHandle,
        bank: shortAccount(customer),
      },
      attention,
      loans: loans.map((loan) => ({ loan_id: loan.id, lender: loan.lender, repayment: repaymentLabel(loan) })),
    },
    say: `Found ${customer.name}'s Paytm account. ${said.join(" ") || "No open issues on it."}`,
  };
}

function merchantProfile(customer: Customer, now: Date): Profile {
  const today = istDateKey(now);
  const payments = db
    .listTransactions(customer.id)
    .filter((txn) => txn.direction === "credit" && txn.status === "success" && istDateKey(new Date(txn.at)) === today);
  const total = payments.reduce((sum, txn) => sum + txn.amount, 0);
  const silent = payments.filter((txn) => txn.announced === false);
  const devices = db.listDevices(customer.id);
  const device = primaryDevice(customer.id);
  const settlement = db.listSettlements(customer.id)[0];
  const billedAfterReturn = devices.filter(
    (candidate) =>
      candidate.status === "returned" &&
      candidate.rental.billingActive &&
      chargesAfterReturn(candidate, db.listRentalCharges(candidate.id)).some((charge) => charge.status === "charged"),
  );
  const loans = db.listLoans(customer.id);
  const business = customer.business?.name ?? customer.name;

  const attention = [
    ...(device?.status === "offline" ? [{ type: "soundbox_offline", device_id: device.id, since: clockOrDay(device.lastSeen) }] : []),
    ...(settlement && settlement.status !== "settled"
      ? [{ type: "settlement_not_paid", settlement_id: settlement.id, for: formatShortDate(settlement.forDate), amount: settlement.amount, status: settlement.status }]
      : []),
    ...billedAfterReturn.map((candidate) => ({ type: "rent_after_return", device_id: candidate.id, model: candidate.model })),
  ];

  const said = [
    payments.length > 0 ? `Today so far: ${plural(payments.length, "payment")}, ${spokenRupees(total)}.` : "No payments yet today.",
  ];
  if (device?.status === "offline") said.push(`The Soundbox has been offline since ${clockOrDay(device.lastSeen)}.`);
  if (settlement && settlement.status !== "settled") said.push(`The settlement for ${formatDayMonth(settlement.forDate)} hasn't been paid.`);
  if (billedAfterReturn[0]) said.push(`Rent is still being charged on the returned ${billedAfterReturn[0].model}.`);

  return {
    detail: [`Merchant`, business, customer.business?.address.split(",").slice(-2, -1)[0]?.trim() ?? customer.city, `MID ••${customer.business?.mid.slice(-4) ?? ""}`, shortAccount(customer)].join(" · "),
    data: { deviceIds: devices.map((candidate) => candidate.id), settlementId: settlement?.id, todayPayments: payments.length, todayTotal: total, unannounced: silent.length },
    result: {
      customer: {
        id: customer.id,
        name: customer.name,
        business,
        city: customer.city,
        language: customer.language,
        mid_last4: customer.business?.mid.slice(-4),
        bank: shortAccount(customer),
      },
      today: { payments: payments.length, total, not_announced: silent.length },
      soundbox: device ? { device_id: device.id, model: device.model, status: device.status, last_seen: clockOrDay(device.lastSeen) } : undefined,
      last_settlement: settlement
        ? { settlement_id: settlement.id, for: formatShortDate(settlement.forDate), amount: settlement.amount, status: settlement.status }
        : undefined,
      attention,
      loans: loans.map((loan) => ({ loan_id: loan.id, lender: loan.lender, repayment: repaymentLabel(loan) })),
    },
    say: `Found ${business}, ${customer.name}. ${said.join(" ")}`,
  };
}

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
    db.updateMoment(momentId, { status: "failed", title: "No Paytm account on this number" });
    return {
      ok: false,
      found: false,
      say: "I couldn't find a Paytm account on this number. Is there another number registered with Paytm?",
    };
  }

  db.updateCall(call.callRef, { customerId: customer.id });
  const now = new Date();
  const profile = customer.kind === "merchant" ? merchantProfile(customer, now) : consumerProfile(customer, now);
  db.updateMoment(momentId, {
    status: "ok",
    title: `Caller is ${customer.name}`,
    detail: profile.detail,
    touched: [customer.id],
    data: { customerId: customer.id, kind: customer.kind, flags: customer.flags, ...profile.data },
  });

  // Risk flags stay off the voice payload so the agent can never read them out to the caller.
  return { ok: true, found: true, kind: customer.kind, ...profile.result, say: profile.say };
}

// ---------- Web and claims ----------

/** Search answers arrive with inline citation links; sources are shown on the console, not read aloud. */
function cleanAnswer(text: string): string {
  return text
    .replace(/\(?\[[^\]]*\]\(https?:[^)]*\)\)?/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
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
    const result = await searchWeb(query);
    const answer = cleanAnswer(result.answer);
    const topSources = result.sources.slice(0, 3);
    if (!answer) {
      db.updateMoment(momentId, { status: "failed", title: "No clear answer on the web", data: { query, sources: topSources } });
      return { ok: false, say: "I couldn't find a clear answer to that right now. I can have a specialist get back to you on it." };
    }
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
    const result = await checkClaim(claim);
    const { verdict } = result;
    const answer = cleanAnswer(result.answer);
    const topSources = result.sources.slice(0, 3);
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
          : verdict === "contradicted"
            ? `That isn't what the official rule says. ${truncate(answer, 300)}`
            : `I checked official RBI and NPCI sources and couldn't find that rule. ${truncate(answer, 300)}`,
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

// ---------- Escalation ----------

interface OwnedRecord {
  id: string;
  category: Ticket["category"];
  label: string;
}

/** Resolves an id the model passes to one of the caller's own records; anything else is ignored. */
function findOwnedRecord(customerId: string, reference: string): OwnedRecord | null {
  const id = asId(reference);
  const digits = digitsOf(reference);
  const records: (OwnedRecord & { aliases: (string | undefined)[] })[] = [
    ...db.listTransactions(customerId).map((txn) => ({
      id: txn.id,
      category: "upi" as const,
      label: `${formatRupees(txn.amount)} ${txn.direction === "debit" ? "to" : "from"} ${txn.counterparty.name}`,
      aliases: [txn.rrn, txn.disputeId],
    })),
    ...db.listRewards(customerId).map((reward) => ({ id: reward.id, category: "rewards" as const, label: reward.offer, aliases: [reward.txnId] })),
    ...db.listLoans(customerId).map((loan) => ({ id: loan.id, category: "loan" as const, label: `${loan.lender} loan`, aliases: [] })),
    ...db.listSettlements(customerId).map((settlement) => ({
      id: settlement.id,
      category: "settlement" as const,
      label: `Settlement ${formatShortDate(settlement.forDate)} ${formatRupees(settlement.amount)}`,
      aliases: [settlement.utr],
    })),
    ...db.listDevices(customerId).map((device) => ({ id: device.id, category: "device" as const, label: device.model, aliases: [] })),
  ];
  const match =
    records.find((record) => record.id === id || record.aliases.includes(id)) ??
    (digits.length >= 4
      ? records.find((record) => endsWithDigits(record.id, digits) || record.aliases.some((alias) => endsWithDigits(alias, digits)))
      : undefined);
  return match ? { id: match.id, category: match.category, label: match.label } : null;
}

function openEscalation(
  call: CallRecord,
  customer: Customer | null,
  input: { reason: string; summary: string; relatedId?: string; relatedLabel?: string; category: Ticket["category"] },
): Ticket {
  const who = customer
    ? `${customer.name} (${customer.kind === "merchant" ? (customer.business?.name ?? "merchant") : "consumer"}, ${customer.city})`
    : `Unidentified caller ${formatPhone(call.phone)}`;
  const brief = [
    who,
    input.relatedId ? `${input.relatedId}${input.relatedLabel ? ` · ${input.relatedLabel}` : ""}` : undefined,
    `Reason: ${input.reason}`,
    input.summary !== input.reason ? input.summary : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const team = customer?.kind === "merchant" ? "Paytm for Business specialist desk" : "Paytm Care specialist desk";
  const { ticket } = upsertCallTicket(
    call.callRef,
    { customerId: customer?.id ?? UNIDENTIFIED_CUSTOMER, relatedId: input.relatedId },
    { category: input.category, subject: input.reason, status: "escalated", priority: "high", note: brief },
  );
  db.recordMoment({
    callRef: call.callRef,
    kind: "escalated",
    system: "helpdesk",
    status: "ok",
    title: `Escalated to a Paytm specialist · ${ticket.id}`,
    detail: brief,
    touched: [ticket.id, ...(input.relatedId ? [input.relatedId] : [])],
    data: { ticketId: ticket.id, priority: "high", team, reason: input.reason, summary: input.summary, brief, relatedId: input.relatedId },
  });
  return ticket;
}

async function escalate(params: ToolParams, call: CallRecord): Promise<ToolResult> {
  const reason = readText(params, "reason") ?? "Customer asked for a person";
  const summary = readText(params, "summary") ?? reason;
  const customer = callerOf(call);
  const reference = readText(params, "related_id");
  const related = customer && reference ? findOwnedRecord(customer.id, reference) : null;

  const ticket = openEscalation(call, customer, {
    reason,
    summary,
    relatedId: related?.id,
    relatedLabel: related?.label,
    category: related?.category ?? "other",
  });
  return {
    ok: true,
    ticket_id: ticket.id,
    callback_within_hours: ESCALATION_CALLBACK_HOURS,
    say:
      `I've handed this to a Paytm specialist with all the details, ticket ${ending(ticket.id)}. ` +
      `They'll call you back within ${ESCALATION_CALLBACK_HOURS} hours, and you won't need to repeat anything.`,
  };
}

const TOOLS = {
  lookup_customer: lookupCustomer,
  get_transaction: getTransaction,
  raise_dispute: raiseDispute,
  check_cashback: checkCashback,
  credit_cashback: creditCashback,
  get_loan: getLoan,
  raise_lender_grievance: raiseLenderGrievance,
  check_payments: checkPayments,
  diagnose_device: diagnoseDevice,
  fix_device: fixDevice,
  book_replacement: bookReplacement,
  get_settlement: getSettlement,
  retry_settlement: retrySettlement,
  send_bank_update_link: sendBankUpdateLink,
  check_rent: checkRent,
  refund_rent: refundRent,
  flag_transaction: flagTransaction,
  search_web: searchTheWeb,
  verify_claim: verifyClaim,
  escalate,
} satisfies Record<string, ToolHandler>;

export type ToolName = keyof typeof TOOLS;

export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOLS, name);
}

/** Policy notes written for the console ("₹1,198", "••4821") are reworded the way a voice engine reads them reliably. */
function speakable(text: string): string {
  return text.replace(/₹\s?(\d[\d,]*(?:\.\d+)?)/g, "$1 rupees").replace(/••\s?/g, "ending ");
}

export async function runTool(name: ToolName, params: ToolParams): Promise<ToolResult> {
  const result = await TOOLS[name](params, callForTool(params));
  return { ...result, say: speakable(result.say) };
}
