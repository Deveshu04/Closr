import {
  AudioLines,
  BadgeCheck,
  CalendarClock,
  CircleAlert,
  FileText,
  Globe,
  Hand,
  Headset,
  IndianRupee,
  type LucideIcon,
  MapPin,
  Package,
  PhoneCall,
  ShieldCheck,
  Truck,
  UserRound,
} from "lucide-react";
import { ESCALATION_CALLBACK_HOURS } from "@/lib/policy";
import type { Approval, ConsoleState, Invoice, Moment, MomentStatus, Order, Refund, Ticket } from "@/lib/types";
import { approvalForMoment } from "../hooks/useApprovals";
import { humanize, inr, weekdayDate } from "../lib/format";
import { pickArray, pickNumber, pickRecord, pickString } from "../lib/data";

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
}

export interface CallerRecords {
  orders: Order[];
  refunds: Refund[];
  invoices: Invoice[];
  tickets: Ticket[];
  approvals: Approval[];
}

const TONE: Record<MomentStatus, Tone> = {
  running: "progress",
  ok: "done",
  waiting: "waiting",
  blocked: "problem",
  failed: "problem",
};

const CALLBACK = `A Paytm specialist will call you back within ${ESCALATION_CALLBACK_HOURS} hours`;

/** The shared state holds every customer; only the caller's own records may reach their screen. */
export function callerRecords(state: ConsoleState): CallerRecords {
  const customerId = state.call?.customerId;
  const callRef = state.call?.callRef;
  if (!customerId) return { orders: [], refunds: [], invoices: [], tickets: [], approvals: [] };
  const orders = state.orders.filter((o) => o.customerId === customerId);
  const orderIds = new Set(orders.map((o) => o.id));
  return {
    orders,
    refunds: state.refunds.filter((r) => orderIds.has(r.orderId)),
    invoices: state.invoices.filter((i) => i.customerId === customerId),
    tickets: state.tickets.filter((t) => t.customerId === customerId),
    approvals: state.approvals.filter((a) => a.callRef === callRef && orderIds.has(a.orderId)),
  };
}

function compact(parts: (string | false | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length ? kept.join(" · ") : undefined;
}

function refTail(id: string | undefined): string | undefined {
  return id ? `Ref …${id.slice(-4)}` : undefined;
}

/** "refund_request" / "Refund for my headphones." → "refund request" / "refund for my headphones" */
function inSentence(text: string): string {
  const t = text.trim().replace(/[.!]+$/, "");
  const readable = /^[a-z]+(?:[_-][a-z]+)*$/.test(t) ? humanize(t) : t;
  return /^[A-Z][a-z]/.test(readable) ? readable.charAt(0).toLowerCase() + readable.slice(1) : readable;
}

function channels(sentTo: unknown[]): string {
  const names = sentTo
    .filter((c): c is string => typeof c === "string")
    .map((c) => ({ whatsapp: "WhatsApp", sms: "SMS", email: "email" })[c.toLowerCase()] ?? c);
  if (names.length <= 1) return names[0] ?? "email";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function oneLineAddress(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined;
  const line1 = pickString(value, "line1");
  const place = [pickString(value, "city"), pickString(value, "pincode")].filter(Boolean).join(" ");
  return [line1, place].filter(Boolean).join(", ") || undefined;
}

function itemsOf(order: Order | undefined): string | undefined {
  const [first, ...rest] = order?.items ?? [];
  if (!first) return undefined;
  return rest.length ? `${first.name} + ${rest.length} more` : first.name;
}

function isNotFound(moment: Moment): boolean {
  return moment.status === "failed" && /not found|no order id/i.test(moment.title);
}

type ActionType = "refund" | "delivery" | "address" | "invoice" | "ticket";

function actionType(moment: Moment): ActionType | null {
  switch (moment.system) {
    case "payments":
      return "refund";
    case "courier":
      return "delivery";
    case "helpdesk":
      return "ticket";
    case "orders":
      return pickString(moment.data, "invoiceNumber") || /invoice/i.test(moment.title) ? "invoice" : "address";
    default:
      return null;
  }
}

function refundLine(refund: Refund | undefined, data: Moment["data"]) {
  const amount = refund?.amount ?? pickNumber(data, "amount");
  const id = refund?.id ?? pickString(data, "refundId");
  const expectedBy = refund?.expectedBy ?? pickString(data, "expectedBy");
  return {
    amount: amount === undefined ? "Refund" : `Refund of ${inr(amount)}`,
    detail: compact([refTail(id), expectedBy && `reaches by ${weekdayDate(expectedBy)}`]),
  };
}

function deliveryLine(moment: Moment, records: CallerRecords) {
  const orderId = pickString(moment.data, "orderId") ?? moment.touched?.find((id) => records.orders.some((o) => o.id === id));
  const order = records.orders.find((o) => o.id === orderId);
  const to = pickString(moment.data, "to") ?? order?.shipment.eta;
  return {
    title: to ? `Delivery moved to ${weekdayDate(to)}` : "Delivery rescheduled",
    detail: compact([pickString(moment.data, "slot") ?? order?.shipment.slot, orderId && `Order ${orderId}`]),
    orderId,
  };
}

function invoiceLine(moment: Moment) {
  const total = pickNumber(moment.data, "total");
  return {
    title: `Invoice sent to your ${channels(pickArray(moment.data, "sentTo"))}`,
    detail: compact([pickString(moment.data, "invoiceNumber"), total !== undefined && inr(total)]),
  };
}

function describeAction(moment: Moment, records: CallerRecords): Omit<Step, "id" | "tone"> | null {
  const tone = TONE[moment.status];
  if (isNotFound(moment)) return { icon: CircleAlert, text: "Couldn't find that order on your account" };
  switch (actionType(moment)) {
    case "refund": {
      if (tone === "progress") return { icon: IndianRupee, text: "Issuing your refund…" };
      if (tone === "problem") return { icon: IndianRupee, text: "Couldn't issue the refund on this call" };
      const refund = records.refunds.find((r) => r.id === pickString(moment.data, "refundId"));
      const line = refundLine(refund, moment.data);
      return { icon: IndianRupee, text: `${line.amount} issued`, detail: line.detail };
    }
    case "delivery": {
      if (tone === "progress") return { icon: CalendarClock, text: "Moving your delivery…" };
      if (tone === "problem") return { icon: CalendarClock, text: "Couldn't move your delivery" };
      const line = deliveryLine(moment, records);
      return { icon: CalendarClock, text: line.title, detail: line.detail };
    }
    case "address": {
      if (tone === "progress") return { icon: MapPin, text: "Updating your delivery address…" };
      if (tone === "problem") return { icon: MapPin, text: "Couldn't change the delivery address" };
      return { icon: MapPin, text: "Delivery address updated", detail: oneLineAddress(pickRecord(moment.data, "to")) };
    }
    case "invoice": {
      if (tone === "progress") return { icon: FileText, text: "Sending your invoice…" };
      if (tone === "problem") {
        return { icon: FileText, text: "Your invoice isn't ready yet", detail: "It's emailed automatically once your order is delivered" };
      }
      const line = invoiceLine(moment);
      return { icon: FileText, text: line.title, detail: line.detail };
    }
    case "ticket": {
      // Resolved tickets are bookkeeping; they're listed in the summary after the call.
      if (pickString(moment.data, "status") === "resolved" || tone !== "done") return null;
      const ticketId = pickString(moment.data, "ticketId");
      return { icon: Headset, text: "Opened a ticket so our team can follow up", detail: ticketId && `Ticket ${ticketId}` };
    }
    default:
      return tone === "done" ? { icon: BadgeCheck, text: "Updated your account" } : null;
  }
}

const CONFIRMED_WITH: Partial<Record<NonNullable<Moment["system"]>, string>> = {
  payments: "our payments system",
  courier: "the courier",
  orders: "your order record",
};

function describe(moment: Moment, records: CallerRecords): Omit<Step, "id" | "tone"> | null {
  const tone = TONE[moment.status];
  switch (moment.kind) {
    case "call":
      return moment.status === "ok" && /picked up/i.test(moment.title)
        ? { icon: PhoneCall, text: "You're connected with Closr" }
        : null;
    case "understood": {
      const intent = pickString(moment.data, "intent") ?? moment.title;
      return { icon: AudioLines, text: `We understood: ${inSentence(intent)}` };
    }
    case "lookup": {
      if (isNotFound(moment)) return { icon: CircleAlert, text: "Couldn't find that order on your account" };
      if (moment.system === "crm") {
        if (tone === "progress") return { icon: UserRound, text: "Checking your account…" };
        if (tone === "problem") return { icon: UserRound, text: "Couldn't find an account on this number" };
        return { icon: UserRound, text: "Checked your account" };
      }
      if (moment.system === "courier") {
        const courier = pickString(moment.data, "courier") ?? "the courier";
        if (tone === "progress") return { icon: Truck, text: `Checking with ${courier}…` };
        if (tone === "waiting") return { icon: Truck, text: "Your return pickup isn't done yet" };
        const pickedAt = pickString(moment.data, "pickedAt");
        return {
          icon: Truck,
          text: `${courier} confirmed your return pickup`,
          detail: pickedAt && `Picked up ${weekdayDate(pickedAt)}`,
        };
      }
      const orderId = pickString(moment.data, "orderId");
      if (tone === "progress" || !orderId) return { icon: Package, text: "Checking your order…" };
      return {
        icon: Package,
        text: `Checked your order ${orderId}`,
        detail: itemsOf(records.orders.find((o) => o.id === orderId)),
      };
    }
    case "policy": {
      if (isNotFound(moment)) return { icon: CircleAlert, text: "Couldn't find that order on your account" };
      if (tone === "progress") return { icon: ShieldCheck, text: "Checking eligibility…" };
      const outcome = pickString(moment.data, "outcome");
      const verdict =
        outcome === "allow"
          ? "Eligible for a refund"
          : outcome === "needs_approval"
            ? "Needs a quick approval"
            : outcome === "deny" || tone === "problem"
              ? "Not eligible for a refund right now"
              : undefined;
      return { icon: ShieldCheck, text: "Checked eligibility", detail: verdict };
    }
    case "action":
      return describeAction(moment, records);
    case "verified": {
      const where = (moment.system && CONFIRMED_WITH[moment.system]) ?? "our systems";
      if (tone === "progress") return { icon: BadgeCheck, text: `Confirming with ${where}…`, minor: true };
      if (tone === "problem") return { icon: CircleAlert, text: "Couldn't confirm this yet", minor: true };
      if (moment.data?.duplicate === true) {
        return { icon: BadgeCheck, text: "Already processed earlier, so nothing was refunded twice", minor: true };
      }
      return { icon: BadgeCheck, text: `Confirmed with ${where}`, minor: true };
    }
    case "approval": {
      const amount = pickNumber(moment.data, "amount");
      return { icon: Hand, text: "", detail: amount !== undefined ? `For your ${inr(amount)} refund` : undefined };
    }
    case "search": {
      const query = pickString(moment.data, "query") ?? moment.detail ?? "your question";
      if (tone === "progress") return { icon: Globe, text: `Looking up: ${query}` };
      if (tone === "problem") return { icon: Globe, text: `Couldn't look up: ${query}` };
      return { icon: Globe, text: `Looked up: ${query}` };
    }
    case "escalated": {
      const ticketId = pickString(moment.data, "ticketId") ?? moment.touched?.[0];
      return { icon: Headset, text: CALLBACK, detail: ticketId && `Ticket ${ticketId}` };
    }
    default:
      return null;
  }
}

function approvalTone(moment: Moment, records: CallerRecords): Tone {
  const approval = approvalForMoment(moment, records.approvals);
  if (!approval) return TONE[moment.status];
  return approval.status === "pending" ? "waiting" : approval.status === "approved" ? "done" : "problem";
}

const APPROVAL_TEXT: Partial<Record<Tone, string>> = {
  waiting: "Getting a quick approval from a Paytm specialist",
  done: "Approved by a Paytm specialist",
  problem: "A Paytm specialist couldn't approve this on the call",
};

/** The call's moments, retold for the customer. Internal detail (rules, flags, briefs, other customers) never appears. */
export function customerFeed(moments: Moment[], records: CallerRecords): Step[] {
  const steps: Step[] = [];
  for (const moment of moments) {
    const step = describe(moment, records);
    if (!step) continue;
    if (moment.kind === "approval") {
      const tone = approvalTone(moment, records);
      steps.push({ ...step, id: moment.id, tone, text: APPROVAL_TEXT[tone] ?? APPROVAL_TEXT.waiting! });
    } else {
      const tone = moment.kind === "escalated" ? "handoff" : TONE[moment.status];
      steps.push({ ...step, id: moment.id, tone });
    }
  }
  return steps;
}

function refundOutcome(refund: Refund | undefined, data: Moment["data"], fallback: Tone): Outcome {
  const line = refundLine(refund, data);
  const id = `refund:${refund?.id ?? pickString(data, "refundId") ?? "unknown"}`;
  const status = refund?.status ?? (fallback === "waiting" ? "pending_approval" : fallback === "problem" ? "rejected" : "processed");
  if (status === "pending_approval") {
    return {
      id,
      icon: Hand,
      tone: "waiting",
      title: `${line.amount} awaiting a specialist's approval`,
      detail: "You'll get an SMS and WhatsApp once it's processed",
    };
  }
  if (status === "rejected") {
    return { id, icon: IndianRupee, tone: "problem", title: `${line.amount} wasn't approved`, detail: refTail(refund?.id) };
  }
  return { id, icon: IndianRupee, tone: "done", title: `${line.amount} issued`, detail: line.detail };
}

/** What changed for the customer on this call, one line per record, for the card shown after hang-up. */
export function summarizeCall(moments: Moment[], records: CallerRecords): { outcomes: Outcome[]; tickets: TicketRef[] } {
  const outcomes = new Map<string, Outcome>();
  const tickets = new Map<string, TicketRef>();

  const noteTicket = (id: string | undefined, fallbackStatus: string) => {
    if (!id) return;
    const record = records.tickets.find((t) => t.id === id);
    tickets.set(id, { id, status: record?.status ?? fallbackStatus, subject: record?.subject });
  };

  for (const moment of moments) {
    if (moment.kind === "approval") {
      const refund = records.refunds.find((r) => r.id === pickString(moment.data, "refundId"));
      const outcome = refundOutcome(refund, moment.data, approvalTone(moment, records));
      outcomes.set(outcome.id, outcome);
      continue;
    }
    if (moment.kind === "escalated") {
      const ticketId = pickString(moment.data, "ticketId") ?? moment.touched?.[0];
      outcomes.set(`handoff:${ticketId ?? moment.id}`, {
        id: `handoff:${ticketId ?? moment.id}`,
        icon: Headset,
        tone: "handoff",
        title: CALLBACK,
        detail: ticketId && `Ticket ${ticketId}`,
      });
      noteTicket(ticketId, "escalated");
      continue;
    }
    if (moment.kind !== "action" || moment.status !== "ok") continue;

    switch (actionType(moment)) {
      case "refund": {
        const refund = records.refunds.find((r) => r.id === pickString(moment.data, "refundId"));
        const outcome = refundOutcome(refund, moment.data, "done");
        outcomes.set(outcome.id, outcome);
        break;
      }
      case "delivery": {
        const line = deliveryLine(moment, records);
        outcomes.set(`delivery:${line.orderId ?? moment.id}`, {
          id: `delivery:${line.orderId ?? moment.id}`,
          icon: CalendarClock,
          tone: "done",
          title: line.title,
          detail: line.detail,
        });
        break;
      }
      case "address": {
        const orderId = moment.touched?.[0];
        outcomes.set(`address:${orderId ?? moment.id}`, {
          id: `address:${orderId ?? moment.id}`,
          icon: MapPin,
          tone: "done",
          title: "Delivery address updated",
          detail: compact([oneLineAddress(pickRecord(moment.data, "to")), orderId && `Order ${orderId}`]),
        });
        break;
      }
      case "invoice": {
        const line = invoiceLine(moment);
        const key = `invoice:${pickString(moment.data, "invoiceNumber") ?? moment.id}`;
        outcomes.set(key, { id: key, icon: FileText, tone: "done", title: line.title, detail: line.detail });
        break;
      }
      case "ticket":
        noteTicket(pickString(moment.data, "ticketId"), pickString(moment.data, "status") ?? "open");
        break;
    }
  }

  return { outcomes: [...outcomes.values()], tickets: [...tickets.values()] };
}
