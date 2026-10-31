import {
  ArrowLeftRight,
  AudioLines,
  BadgeCheck,
  BookCheck,
  CircleAlert,
  Gift,
  HandCoins,
  Headset,
  Landmark,
  LifeBuoy,
  type LucideIcon,
  PhoneCall,
  Receipt,
  RotateCcw,
  Scale,
  ShieldCheck,
  Speaker,
  Store,
  UserRound,
  UserRoundCheck,
  Volume2,
} from "lucide-react";
import { ESCALATION_CALLBACK_HOURS } from "@/lib/policy";
import type { Approval, ConsoleState, Moment, MomentStatus, Payout, ProfileKind, SystemName } from "@/lib/types";
import { approvalForMoment } from "../hooks/useApprovals";
import { pickNumber, pickString } from "../lib/data";
import { humanize, inr, shortDate, shortDateTime, timeOfDay, weekdayDate } from "../lib/format";
import { type RecordBook, type RecordHit, type RecordType, recordsFor, repeatedDeductions, touchedRecords } from "../lib/records";

export type Tone = "progress" | "done" | "waiting" | "problem" | "handoff";

/** One line of the customer's live feed: what Closr did, in the customer's words. */
export interface Step {
  id: string;
  icon: LucideIcon;
  text: string;
  detail?: string;
  tone: Tone;
  /** A confirmation of the step above it, drawn small. */
  minor?: boolean;
}

export interface Outcome {
  id: string;
  icon: LucideIcon;
  title: string;
  detail?: string;
  tone: Tone;
}

export interface TicketRef {
  id: string;
  status: string;
  subject?: string;
  routedTo?: string;
}

export interface CallerRecords extends RecordBook {
  kind: ProfileKind;
  approvals: Approval[];
}

const TONE: Record<MomentStatus, Tone> = {
  running: "progress",
  ok: "done",
  waiting: "waiting",
  blocked: "problem",
  failed: "problem",
};

/** The shared state holds every customer; only the caller's own records may reach their screen. */
export function callerRecords(state: ConsoleState): CallerRecords {
  const customerId = state.call?.customerId;
  const book = recordsFor(state, customerId);
  return {
    ...book,
    kind: book.customers[0]?.kind ?? "consumer",
    approvals: customerId
      ? state.approvals.filter((a) => a.callRef === state.call?.callRef && a.customerId === customerId)
      : [],
  };
}

function compact(parts: (string | false | undefined | null)[]): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length ? kept.join(" · ") : undefined;
}

function refTail(id: string | undefined): string | undefined {
  return id ? `Ref …${id.replace(/\s/g, "").slice(-4)}` : undefined;
}

function bankOf(records: CallerRecords): string {
  const bank = records.customers[0]?.bank.bank;
  return bank ? `your ${bank} account` : "your bank account";
}

/** "upi_debited_not_credited" / "Refund for my payment." → "UPI debited not credited" / "refund for my payment" */
function inSentence(text: string): string {
  const t = text.trim().replace(/[.!]+$/, "");
  const readable = /^[a-z]+(?:[_-][a-z]+)*$/.test(t) ? humanize(t) : t;
  if (/^(Paytm|Soundbox)\b/.test(readable)) return readable;
  return /^[A-Z][a-z]/.test(readable) ? readable.charAt(0).toLowerCase() + readable.slice(1) : readable;
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

type Hit<K extends RecordType> = Extract<RecordHit, { type: K }>;

function hitOf<K extends RecordType>(hits: RecordHit[], type: K): Hit<K> | undefined {
  return hits.find((h): h is Hit<K> => h.type === type);
}

function wording(moment: Moment): string {
  return `${moment.title} ${moment.detail ?? ""}`.toLowerCase();
}

type Intent =
  | "dispute"
  | "reversal"
  | "cashback"
  | "rent_refund"
  | "settlement_retry"
  | "device"
  | "replacement"
  | "bank_link"
  | "billing_stop"
  | "grievance"
  | "ticket";

function intentOf(moment: Moment, hits: RecordHit[]): Intent | null {
  const words = wording(moment);
  const payout = hitOf(hits, "payout")?.record;
  if (payout) return payout.kind;
  if (moment.system === "crm" && /link/.test(words)) return "bank_link";
  if (/replacement/.test(words)) return "replacement";
  if (hitOf(hits, "dispute") || pickString(moment.data, "disputeId") || /dispute/.test(moment.title.toLowerCase())) {
    return "dispute";
  }
  if (hitOf(hits, "settlement") || moment.system === "settlements") return "settlement_retry";
  if (moment.system === "billing" || hitOf(hits, "rentalCharge")) {
    return /refund/.test(words) ? "rent_refund" : "billing_stop";
  }
  if (hitOf(hits, "device") || moment.system === "devices") return "device";
  if (hitOf(hits, "reward") || moment.system === "rewards") return "cashback";
  const ticket = hitOf(hits, "ticket")?.record;
  if (ticket?.routedTo || hitOf(hits, "loan") || moment.system === "lending") return "grievance";
  if (ticket || moment.system === "helpdesk") return "ticket";
  const txn = hitOf(hits, "transaction")?.record;
  if (txn?.status === "reversed") return "reversal";
  return txn || moment.system === "upi" ? "dispute" : null;
}

const INTENT_META: Record<Intent, { icon: LucideIcon; doing: string; failed: string }> = {
  dispute: { icon: Scale, doing: "Raising a UPI dispute…", failed: "Couldn't raise the dispute on this call" },
  reversal: { icon: RotateCcw, doing: "Checking your reversal…", failed: "Couldn't confirm the reversal yet" },
  cashback: { icon: Gift, doing: "Crediting your cashback…", failed: "Couldn't credit the cashback on this call" },
  rent_refund: { icon: Receipt, doing: "Refunding your Soundbox rent…", failed: "Couldn't refund the rent on this call" },
  settlement_retry: { icon: Landmark, doing: "Retrying your settlement…", failed: "Couldn't retry the settlement on this call" },
  device: { icon: Speaker, doing: "Working on your Soundbox remotely…", failed: "Couldn't fix your Soundbox remotely" },
  replacement: { icon: Speaker, doing: "Booking a replacement Soundbox…", failed: "Couldn't book a replacement on this call" },
  bank_link: { icon: Landmark, doing: "Sending you a secure link…", failed: "Couldn't send the link on this call" },
  billing_stop: { icon: Receipt, doing: "Stopping rent on your returned Soundbox…", failed: "Couldn't stop the rent on this call" },
  grievance: { icon: HandCoins, doing: "Sending your complaint to the lender…", failed: "Couldn't send the complaint on this call" },
  ticket: { icon: LifeBuoy, doing: "Opening a request for our team…", failed: "Couldn't open a request on this call" },
};

type Line = Omit<Step, "id" | "tone">;

function payoutLine(payout: Payout | undefined, kind: Payout["kind"], moment: Moment, records: CallerRecords): Line {
  const amount = payout?.amount ?? pickNumber(moment.data, "amount");
  const money = amount === undefined ? "" : `${inr(amount)} `;
  const rrn = payout?.rrn ?? pickString(moment.data, "rrn");
  const landing = rrn ? refTail(rrn) : payout?.expectedBy && `Reaches by ${weekdayDate(payout.expectedBy)}`;
  if (payout?.status === "pending_approval") {
    return { icon: UserRoundCheck, text: `Your ${money}${kind === "cashback" ? "cashback" : "refund"} needs a quick approval` };
  }
  if (payout?.status === "rejected") {
    return { icon: CircleAlert, text: `Your ${money}${kind === "cashback" ? "cashback" : "refund"} wasn't approved` };
  }
  switch (kind) {
    case "cashback":
      return {
        icon: Gift,
        text: amount === undefined ? `Cashback credited to ${bankOf(records)}` : `Cashback of ${inr(amount)} credited to ${bankOf(records)}`,
        detail: landing || undefined,
      };
    case "rent_refund":
      return {
        icon: Receipt,
        text: amount === undefined ? "Soundbox rent refunded" : `Refund of ${inr(amount)} for your Soundbox rent`,
        detail: compact([`To ${bankOf(records)}`, landing]),
      };
    case "settlement_retry": {
      const settlement = records.settlements.find((s) => s.id === payout?.subjectId);
      return {
        icon: Landmark,
        text: amount === undefined ? "Settlement sent to your bank" : `Settlement of ${inr(amount)} sent to ${bankOf(records)}`,
        detail: compact([settlement && `For ${shortDate(settlement.forDate)}`, settlement?.utr ? `UTR …${settlement.utr.slice(-4)}` : landing]),
      };
    }
  }
}

function deviceLine(moment: Moment, hits: RecordHit[]): Line {
  const device = hitOf(hits, "device")?.record;
  const words = wording(moment);
  const restarted = /restart|reboot|power cycle|back online/.test(words);
  const updated = /firmware|software|update|upgrade/.test(words);
  const tested = /test|announce/.test(words);
  const online = device?.status === "online";
  const parts = [
    restarted && online && "it's back online",
    updated && !restarted && device && `now on ${device.health.firmware}`,
    updated && restarted && "software updated",
    tested && (restarted || updated) && "₹1 test announcement played",
  ];
  const text = restarted
    ? "Restarted your Soundbox remotely"
    : updated
      ? "Updated your Soundbox software"
      : tested
        ? "Played a ₹1 test announcement"
        : "Fixed your Soundbox remotely";
  const detail = compact(parts) ?? (tested && !restarted && !updated ? "Your Soundbox is announcing payments again" : undefined);
  return { icon: tested && !restarted && !updated ? Volume2 : Speaker, text, detail: detail && capitalize(detail) };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function describeAction(moment: Moment, records: CallerRecords): Line | null {
  const tone = TONE[moment.status];
  const hits = touchedRecords(records, moment.touched);
  const intent = intentOf(moment, hits);
  if (!intent) return tone === "done" ? { icon: BadgeCheck, text: "Updated your account" } : null;
  const meta = INTENT_META[intent];
  if (tone === "progress") return { icon: meta.icon, text: meta.doing };
  if (tone === "problem") return { icon: CircleAlert, text: meta.failed };

  switch (intent) {
    case "dispute": {
      const dispute = hitOf(hits, "dispute")?.record;
      const txn = hitOf(hits, "transaction")?.record ?? records.transactions.find((t) => t.id === dispute?.txnId);
      const deadline = txn?.reversal?.deadline ?? pickString(moment.data, "deadline");
      const expectedBy = dispute?.expectedBy ?? pickString(moment.data, "expectedBy");
      return {
        icon: Scale,
        text: "We raised a UPI dispute",
        detail: compact([
          refTail(dispute?.id ?? pickString(moment.data, "disputeId")),
          deadline
            ? `your bank must reverse by ${weekdayDate(deadline)}`
            : expectedBy && `resolved by ${weekdayDate(expectedBy)}`,
        ]),
      };
    }
    case "reversal": {
      const txn = hitOf(hits, "transaction")?.record;
      return {
        icon: RotateCcw,
        text: txn ? `Your ${inr(txn.amount)} was already reversed` : "Your money was already reversed",
        detail: compact([
          txn?.reversal?.reversedAt && `Back in ${bankOf(records)} on ${shortDate(txn.reversal.reversedAt)}`,
          refTail(txn?.reversal?.rrn),
        ]),
      };
    }
    case "cashback":
    case "rent_refund":
    case "settlement_retry": {
      const payout = hitOf(hits, "payout")?.record;
      if (payout || intent !== "settlement_retry") return payoutLine(payout, intent, moment, records);
      const settlement = hitOf(hits, "settlement")?.record;
      return {
        icon: Landmark,
        text: settlement ? `Settlement of ${inr(settlement.amount)} retried to ${bankOf(records)}` : "Settlement retried",
        detail: compact([settlement && `For ${shortDate(settlement.forDate)}`, settlement?.utr && `UTR …${settlement.utr.slice(-4)}`]),
      };
    }
    case "device":
      return deviceLine(moment, hits);
    case "replacement": {
      const ticket = hitOf(hits, "ticket")?.record;
      return { icon: Speaker, text: "A replacement Soundbox is on its way", detail: refTail(ticket?.id) };
    }
    case "bank_link":
      return {
        icon: Landmark,
        text: "Sent you a secure link to update your bank account",
        detail: "In the Paytm for Business app and by SMS · valid for 24 hours",
      };
    case "billing_stop":
      return { icon: Receipt, text: "Stopped rent on your returned Soundbox", detail: "No more monthly charges" };
    case "grievance": {
      const ticket = hitOf(hits, "ticket")?.record;
      const loan = hitOf(hits, "loan")?.record ?? records.loans[0];
      return {
        icon: HandCoins,
        text: loan ? `Sent your complaint to ${loan.lender}` : "Sent your complaint to the lender",
        detail: compact([refTail(ticket?.id), "their grievance officer will contact you"]),
      };
    }
    case "ticket":
      // Ticket bookkeeping rides along with every fix; the requests are listed once, after the call.
      return null;
  }
}

function describeLookup(moment: Moment, records: CallerRecords): Line | null {
  const tone = TONE[moment.status];
  const hits = touchedRecords(records, moment.touched);
  const merchant = records.kind === "merchant";
  const system: SystemName | undefined = moment.system;

  if (tone === "problem") {
    // A failed lookup elsewhere is usually Closr asking which record was meant; the call carries on.
    return system === "crm" ? { icon: CircleAlert, text: "Couldn't find an account on this number" } : null;
  }

  switch (system) {
    case "upi": {
      if (tone === "progress") return { icon: ArrowLeftRight, text: merchant ? "Checking today's payments…" : "Checking your UPI payments…" };
      const txns = hits.filter((h): h is Hit<"transaction"> => h.type === "transaction").map((h) => h.record);
      if (merchant) {
        const missed = records.transactions.filter((t) => t.announced === false && t.status === "success");
        return {
          icon: ArrowLeftRight,
          text: "Checked today's payments",
          detail: missed.length
            ? `${missed.length} payments reached you but weren't announced · your money is safe`
            : undefined,
        };
      }
      const [txn] = txns;
      if (txns.length === 1 && txn) {
        return {
          icon: ArrowLeftRight,
          text: `Found your ${inr(txn.amount)} payment to ${txn.counterparty.name}`,
          detail:
            txn.status === "debited_not_credited"
              ? `Debited ${shortDateTime(txn.at)} · it didn't reach them`
              : txn.status === "reversed"
                ? "Already reversed to your account"
                : shortDateTime(txn.at),
        };
      }
      return { icon: ArrowLeftRight, text: "Checked your recent UPI payments" };
    }
    case "settlements": {
      if (tone === "progress") return { icon: Landmark, text: "Checking your settlements…" };
      const settlement = hitOf(hits, "settlement")?.record;
      const seen = pickString(moment.data, "status") ?? settlement?.status;
      return {
        icon: Landmark,
        text: settlement ? `Checked your settlement for ${shortDate(settlement.forDate)}` : "Checked your settlements",
        detail: settlement && seen === "failed" ? `${inr(settlement.amount)} didn't reach your bank` : undefined,
      };
    }
    case "devices": {
      if (tone === "progress") return { icon: Speaker, text: "Checking your Soundbox…" };
      const device = hitOf(hits, "device")?.record ?? records.devices.find((d) => d.status !== "returned");
      if (!device) return { icon: Speaker, text: "Checked your Soundbox" };
      // What the lookup saw at the time, not what the device says now, after Closr has fixed it.
      const seen = pickString(moment.data, "status") ?? device.status;
      return {
        icon: Speaker,
        text: `Checked your Soundbox · it's ${seen === "online" ? "online" : seen === "offline" ? "offline" : "returned"}`,
        detail: seen === "offline" ? `Last seen at ${timeOfDay(pickString(moment.data, "lastSeen") ?? device.lastSeen)}` : undefined,
      };
    }
    case "billing":
      return { icon: Receipt, text: tone === "progress" ? "Checking your rental charges…" : "Checked your Soundbox rental charges" };
    case "rewards": {
      if (tone === "progress") return { icon: Gift, text: "Checking your cashback…" };
      const pending = records.rewards.filter((r) => r.status === "pending" || r.status === "failed");
      return {
        icon: Gift,
        text: "Checked your cashback",
        detail: pending.length ? `${pending.length} ${pending.length === 1 ? "cashback hasn't" : "cashbacks haven't"} reached you yet` : undefined,
      };
    }
    case "lending": {
      if (tone === "progress") return { icon: HandCoins, text: "Checking your loan EMIs…" };
      const loan = hitOf(hits, "loan")?.record ?? records.loans[0];
      const repeated = loan ? repeatedDeductions(loan) : new Set<string>();
      const twice = loan?.deductions.find((d) => repeated.has(d.id));
      return {
        icon: HandCoins,
        text: loan ? `Checked your ${loan.lender} loan` : "Checked your loan",
        detail: twice ? `Your EMI was deducted twice on ${shortDate(twice.at)}` : undefined,
      };
    }
    case "payouts":
      return { icon: Gift, text: tone === "progress" ? "Checking your refunds…" : "Checked your refunds and cashback" };
    case "helpdesk":
      return { icon: LifeBuoy, text: tone === "progress" ? "Checking your open requests…" : "Checked your open requests" };
    default:
      return merchant
        ? { icon: Store, text: tone === "progress" ? "Checking your business account…" : "Checked your business account" }
        : { icon: UserRound, text: tone === "progress" ? "Checking your account…" : "Checked your account" };
  }
}

const CONFIRMED_WITH: Partial<Record<SystemName, string>> = {
  upi: "the UPI network",
  settlements: "your bank",
  devices: "your Soundbox",
  billing: "our billing system",
  rewards: "Paytm rewards",
  lending: "the lender",
  payouts: "Paytm payouts",
};

const PAYOUT_WORD: Record<Payout["kind"], string> = {
  cashback: "cashback",
  rent_refund: "rent refund",
  settlement_retry: "settlement",
};

function callbackLine(moment: Moment): Line {
  const hours = pickNumber(moment.data, "callbackWithinHours", "callbackHours", "callback_within_hours") ?? ESCALATION_CALLBACK_HOURS;
  const ticketId = pickString(moment.data, "ticketId") ?? moment.touched?.[0];
  return {
    icon: Headset,
    text: `A Paytm specialist will call you back within ${hours} ${hours === 1 ? "hour" : "hours"}`,
    detail: refTail(ticketId),
  };
}

function describe(moment: Moment, records: CallerRecords): Line | null {
  const tone = TONE[moment.status];
  switch (moment.kind) {
    case "call":
      return moment.status === "ok" && /picked up|connected|answered/i.test(moment.title)
        ? { icon: PhoneCall, text: "You're connected with Closr" }
        : null;
    case "understood": {
      const intent = pickString(moment.data, "intent") ?? moment.title;
      return { icon: AudioLines, text: `We understood: ${inSentence(intent)}` };
    }
    case "lookup":
      return describeLookup(moment, records);
    case "policy": {
      const topic = pickString(moment.data, "topic");
      const subject = topic ? `the rules for your ${inSentence(topic)}` : "what we can do";
      if (tone === "progress") return { icon: ShieldCheck, text: `Checking ${subject}…` };
      const outcome = pickString(moment.data, "outcome");
      const verdict =
        outcome === "allow"
          ? "Closr can fix this on the call"
          : outcome === "needs_approval"
            ? "Needs a quick approval"
            : outcome === "deny" || tone === "problem"
              ? "Can't be done on this call"
              : undefined;
      return { icon: ShieldCheck, text: `Checked ${subject}`, detail: verdict };
    }
    case "action":
      return describeAction(moment, records);
    case "verified": {
      const where = (moment.system && CONFIRMED_WITH[moment.system]) ?? "our systems";
      if (tone === "progress") return { icon: BadgeCheck, text: `Confirming with ${where}…`, minor: true };
      if (tone === "problem") return { icon: CircleAlert, text: "Couldn't confirm this yet", minor: true };
      if (moment.data?.duplicate === true) {
        return { icon: BadgeCheck, text: "Already done earlier, so nothing was paid twice", minor: true };
      }
      return { icon: BadgeCheck, text: `Confirmed with ${where}`, minor: true };
    }
    case "approval": {
      const approval = approvalForMoment(moment, records.approvals);
      const amount = approval?.amount ?? pickNumber(moment.data, "amount");
      const word = approval ? PAYOUT_WORD[approval.kind] : "request";
      return { icon: UserRoundCheck, text: "", detail: amount !== undefined ? `For your ${inr(amount)} ${word}` : undefined };
    }
    case "search": {
      const claim = pickString(moment.data, "claim");
      if (claim || pickString(moment.data, "verdict")) {
        if (tone === "progress") return { icon: BookCheck, text: "Checking the official RBI and NPCI rules…" };
        if (moment.status === "failed") return { icon: BookCheck, text: "Couldn't reach the official rules right now" };
        const answer = pickString(moment.data, "answer");
        return { icon: BookCheck, text: "Checked the official rule", detail: answer && shorten(answer, 150) };
      }
      const query = pickString(moment.data, "query") ?? moment.detail ?? "your question";
      if (tone === "progress") return { icon: BookCheck, text: `Looking up: ${query}` };
      if (tone === "problem") return { icon: BookCheck, text: `Couldn't look up: ${query}` };
      return { icon: BookCheck, text: `Looked up: ${query}` };
    }
    case "escalated":
      return callbackLine(moment);
    default:
      return null;
  }
}

function approvalTone(moment: Moment, records: CallerRecords): Tone {
  const approval = approvalForMoment(moment, records.approvals);
  if (!approval) return TONE[moment.status];
  return approval.status === "pending" ? "waiting" : approval.status === "approved" ? "done" : "problem";
}

const APPROVAL_TEXT: Record<"waiting" | "done" | "problem", string> = {
  waiting: "Getting a quick approval from a Paytm specialist",
  done: "Approved by a Paytm specialist",
  problem: "A Paytm specialist couldn't approve this on the call",
};

/** A rule check that says "no" is information for the customer, not a failure on their account. */
function feedTone(moment: Moment): Tone {
  if (moment.kind === "escalated") return "handoff";
  const informational = moment.kind === "policy" || moment.kind === "search";
  if (informational && moment.status === "blocked") return "done";
  return TONE[moment.status];
}

/** The call's moments, retold for the customer. Internal detail (rules, flags, briefs, other customers) never appears. */
export function customerFeed(moments: Moment[], records: CallerRecords): Step[] {
  const steps: Step[] = [];
  for (const moment of moments) {
    const line = describe(moment, records);
    if (!line) continue;
    if (moment.kind === "approval") {
      const tone = approvalTone(moment, records);
      const text = tone === "waiting" || tone === "done" || tone === "problem" ? APPROVAL_TEXT[tone] : APPROVAL_TEXT.waiting;
      steps.push({ ...line, id: moment.id, tone, text });
    } else {
      steps.push({ ...line, id: moment.id, tone: feedTone(moment) });
    }
  }
  return steps.map(capitalDetail);
}

function capitalDetail<T extends { detail?: string }>(item: T): T {
  return item.detail ? { ...item, detail: capitalize(item.detail) } : item;
}

function approvalOutcome(approval: Approval, records: CallerRecords): Outcome {
  const id = `payout:${approval.kind}:${approval.subjectId}`;
  const word = PAYOUT_WORD[approval.kind];
  const payout = records.payouts.find((p) => p.subjectId === approval.subjectId && p.kind === approval.kind);
  if (approval.status === "pending" || payout?.status === "pending_approval") {
    return {
      id,
      icon: UserRoundCheck,
      tone: "waiting",
      title: `${inr(approval.amount)} ${word} awaiting a specialist's approval`,
      detail: "You'll get an SMS as soon as it's done",
    };
  }
  if (approval.status === "denied" || payout?.status === "rejected") {
    return { id, icon: CircleAlert, tone: "problem", title: `${inr(approval.amount)} ${word} wasn't approved` };
  }
  const moment: Moment = {
    id,
    callRef: approval.callRef,
    kind: "action",
    title: word,
    status: "ok",
    at: approval.decidedAt ?? approval.createdAt,
    data: { amount: approval.amount },
  };
  const line = payoutLine(payout, approval.kind, moment, records);
  return { id, icon: line.icon, tone: "done", title: line.text, detail: line.detail };
}

function outcomeKey(moment: Moment, records: CallerRecords): string {
  const hits = touchedRecords(records, moment.touched);
  const payout = hitOf(hits, "payout")?.record;
  if (payout) return `payout:${payout.kind}:${payout.subjectId}`;
  const kind = pickString(moment.data, "kind");
  const subjectId = pickString(moment.data, "subjectId");
  if (kind && subjectId && pickString(moment.data, "payoutId")) return `payout:${kind}:${subjectId}`;
  const primary = hits.find((h) => h.type !== "customer" && h.type !== "transaction") ?? hits[0];
  return primary ? `${primary.type}:${primary.record.id}:${wording(moment).slice(0, 24)}` : moment.id;
}

/** What changed for the customer on this call, one line per record, for the card shown after hang-up. */
export function summarizeCall(
  moments: Moment[],
  records: CallerRecords,
): { outcomes: Outcome[]; handoffs: Outcome[]; tickets: TicketRef[] } {
  const outcomes = new Map<string, Outcome>();
  const handoffs = new Map<string, Outcome>();
  const tickets = new Map<string, TicketRef>();

  const noteTickets = (moment: Moment) => {
    for (const hit of touchedRecords(records, moment.touched)) {
      if (hit.type !== "ticket") continue;
      const t = hit.record;
      tickets.set(t.id, { id: t.id, status: t.status, subject: t.subject, routedTo: t.routedTo });
    }
  };

  for (const moment of moments) {
    if (moment.kind === "approval") {
      const approval = approvalForMoment(moment, records.approvals);
      if (approval) {
        const outcome = approvalOutcome(approval, records);
        outcomes.set(outcome.id, outcome);
      }
      continue;
    }
    if (moment.kind === "escalated") {
      const line = callbackLine(moment);
      handoffs.set(moment.id, { id: moment.id, icon: line.icon, tone: "handoff", title: line.text, detail: line.detail });
      noteTickets(moment);
      continue;
    }
    if (moment.kind !== "action" || moment.status !== "ok") continue;
    noteTickets(moment);
    const line = describeAction(moment, records);
    if (!line) continue;
    const key = outcomeKey(moment, records);
    outcomes.set(key, { id: key, icon: line.icon, tone: "done", title: line.text, detail: line.detail });
  }

  return {
    outcomes: [...outcomes.values()].map(capitalDetail),
    handoffs: [...handoffs.values()].map(capitalDetail),
    tickets: [...tickets.values()],
  };
}
