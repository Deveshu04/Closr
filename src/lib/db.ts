import fs from "node:fs";
import path from "node:path";
import { normalizePhone } from "@/lib/format";
import { voiceSafeId } from "@/lib/ids";
import { createSeed, DEMO_CUSTOMER_ID, type SeedData } from "@/lib/seed";
import type {
  Approval,
  CallRecord,
  ConsoleState,
  Customer,
  Invoice,
  Moment,
  Order,
  Refund,
  Ticket,
} from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "db.json");
/** Bump when the stored shape or seed story changes, so an old db.json is re-seeded instead of misread. */
const SCHEMA_VERSION = 1;
const MOMENT_HISTORY_LIMIT = 1000;

interface DbState extends SeedData {
  version: number;
  seededAt: string;
  activeCallRef: string | null;
  calls: CallRecord[];
  moments: Moment[];
  approvals: Approval[];
}

function freshState(): DbState {
  return {
    version: SCHEMA_VERSION,
    seededAt: new Date().toISOString(),
    activeCallRef: null,
    calls: [],
    moments: [],
    approvals: [],
    ...createSeed(),
  };
}

function save(state: DbState): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(state, null, 2);
  const temp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, json);
  // Write-then-rename keeps readers from ever seeing half a file. Windows refuses the
  // rename while another handle has db.json open, so fall back to a direct write.
  try {
    fs.renameSync(temp, DB_FILE);
  } catch {
    fs.writeFileSync(DB_FILE, json);
    fs.rmSync(temp, { force: true });
  }
}

function load(): DbState {
  try {
    const stored = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as DbState;
    if (stored.version === SCHEMA_VERSION) return stored;
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (!missing && !(error instanceof SyntaxError)) throw error;
  }
  const state = freshState();
  save(state);
  return state;
}

// Every call re-reads the file, so state is shared across route bundles and survives hot reloads.
// Reads and writes are synchronous, which makes each read-modify-write atomic within the server process.
function read<T>(select: (state: DbState) => T): T {
  return select(load());
}

function write<T>(change: (state: DbState) => T): T {
  const state = load();
  const result = change(state);
  save(state);
  return result;
}

function newestFirst<T>(items: T[], timestamp: (item: T) => string): T[] {
  return [...items].sort((a, b) => timestamp(b).localeCompare(timestamp(a)));
}

function samePhone(a: string, b: string): boolean {
  const left = normalizePhone(a);
  return left !== "" && left === normalizePhone(b);
}

export function resetDb(): void {
  save(freshState());
}

export function getState(): ConsoleState {
  return read((state) => {
    const call = state.calls.find((candidate) => candidate.callRef === state.activeCallRef) ?? null;
    return {
      call,
      moments: call ? state.moments.filter((moment) => moment.callRef === call.callRef) : [],
      approvals: newestFirst(state.approvals, (approval) => approval.createdAt),
      customers: state.customers,
      orders: newestFirst(state.orders, (order) => order.placedAt),
      refunds: newestFirst(state.refunds, (refund) => refund.createdAt),
      tickets: newestFirst(state.tickets, (ticket) => ticket.updatedAt),
      invoices: newestFirst(state.invoices, (invoice) => invoice.issuedAt),
    };
  });
}

// ---------- Calls ----------

export function createCall(phone: string): CallRecord {
  return write((state) => {
    const normalized = normalizePhone(phone);
    const call: CallRecord = {
      callRef: voiceSafeId("CL"),
      phone: normalized,
      customerId: state.customers.find((customer) => samePhone(customer.phone, normalized))?.id,
      status: "dialing",
      startedAt: new Date().toISOString(),
    };
    state.calls.push(call);
    state.activeCallRef = call.callRef;
    return call;
  });
}

export function updateCall(callRef: string, patch: Partial<CallRecord>): CallRecord | null {
  return write((state) => {
    const call = state.calls.find((candidate) => candidate.callRef === callRef);
    if (!call) return null;
    Object.assign(call, patch, { callRef });
    return call;
  });
}

export function getCall(callRef: string): CallRecord | null {
  return read((state) => state.calls.find((call) => call.callRef === callRef) ?? null);
}

export function findCallByExecutionId(executionId: string): CallRecord | null {
  return read((state) => state.calls.find((call) => call.bolnaExecutionId === executionId) ?? null);
}

/** The most recently started call, whatever its status; the console keeps showing it after hang-up. */
export function getActiveCall(): CallRecord | null {
  return read((state) => state.calls.find((call) => call.callRef === state.activeCallRef) ?? null);
}

// ---------- Moments ----------

export function recordMoment(input: Omit<Moment, "id" | "at">): Moment {
  return write((state) => {
    const moment: Moment = { ...input, id: voiceSafeId("MO", 10), at: new Date().toISOString() };
    state.moments.push(moment);
    if (state.moments.length > MOMENT_HISTORY_LIMIT) {
      state.moments.splice(0, state.moments.length - MOMENT_HISTORY_LIMIT);
    }
    return moment;
  });
}

/** Merges `data` rather than replacing it, so a step can add results to what it recorded when it started. */
export function updateMoment(id: string, patch: Partial<Moment>): void {
  write((state) => {
    const moment = state.moments.find((candidate) => candidate.id === id);
    if (!moment) return;
    const data = patch.data ? { ...moment.data, ...patch.data } : moment.data;
    Object.assign(moment, patch, { id: moment.id, callRef: moment.callRef, at: moment.at, data });
  });
}

export function listMoments(callRef: string): Moment[] {
  return read((state) => state.moments.filter((moment) => moment.callRef === callRef));
}

// ---------- Customers ----------

export function getCustomer(id: string): Customer | null {
  return read((state) => state.customers.find((customer) => customer.id === id) ?? null);
}

export function findCustomerByPhone(phone: string): Customer | null {
  return read((state) => state.customers.find((customer) => samePhone(customer.phone, phone)) ?? null);
}

/** Hands an unknown number to the seeded demo customer, so whoever is demoing hears their own story. */
export function claimDemoCustomer(phone: string): Customer {
  return write((state) => {
    const owner = state.customers.find((customer) => samePhone(customer.phone, phone));
    if (owner) return owner;
    const demo = state.customers.find((customer) => customer.id === DEMO_CUSTOMER_ID);
    if (!demo) throw new Error("Seed data has no demo customer");
    demo.phone = normalizePhone(phone);
    return demo;
  });
}

// ---------- Orders ----------

export function getOrder(id: string): Order | null {
  return read((state) => state.orders.find((order) => order.id === id) ?? null);
}

/** Newest first; all orders when no customer is given. */
export function listOrders(customerId?: string): Order[] {
  return read((state) =>
    newestFirst(
      state.orders.filter((order) => !customerId || order.customerId === customerId),
      (order) => order.placedAt,
    ),
  );
}

export function updateOrder(id: string, patch: Partial<Omit<Order, "id">>): Order | null {
  return write((state) => {
    const order = state.orders.find((candidate) => candidate.id === id);
    if (!order) return null;
    Object.assign(order, patch);
    return order;
  });
}

// ---------- Refunds ----------

export function getRefund(id: string): Refund | null {
  return read((state) => state.refunds.find((refund) => refund.id === id) ?? null);
}

export function findRefundForOrder(orderId: string): Refund | null {
  return read((state) => state.refunds.find((refund) => refund.orderId === orderId) ?? null);
}

export function listRefunds(customerId: string): Refund[] {
  return read((state) => {
    const orderIds = new Set(
      state.orders.filter((order) => order.customerId === customerId).map((order) => order.id),
    );
    return state.refunds.filter((refund) => orderIds.has(refund.orderId));
  });
}

/**
 * One refund record per order. The existence check and the insert share a single write,
 * so two overlapping requests for the same order can't both create one.
 */
export function insertRefundOnce(refund: Refund): { refund: Refund; created: boolean } {
  return write((state) => {
    const existing = state.refunds.find((candidate) => candidate.orderId === refund.orderId);
    if (existing) return { refund: existing, created: false };
    state.refunds.push(refund);
    return { refund, created: true };
  });
}

/** Moves a refund out of pending_approval; returns null if it was already settled. */
export function settleRefund(
  id: string,
  outcome: { status: "processed"; utr: string; expectedBy: string } | { status: "rejected" },
): Refund | null {
  return write((state) => {
    const refund = state.refunds.find((candidate) => candidate.id === id);
    if (!refund || refund.status !== "pending_approval") return null;
    Object.assign(refund, outcome);
    return refund;
  });
}

// ---------- Approvals ----------

export function createApproval(input: Omit<Approval, "id" | "status" | "createdAt">): Approval {
  return write((state) => {
    const approval: Approval = {
      ...input,
      id: voiceSafeId("APR"),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    state.approvals.push(approval);
    return approval;
  });
}

export function getApproval(id: string): Approval | null {
  return read((state) => state.approvals.find((approval) => approval.id === id) ?? null);
}

/** Only a pending approval changes; deciding twice returns the first decision untouched. */
export function decideApproval(id: string, decision: "approved" | "denied"): Approval | null {
  return write((state) => {
    const approval = state.approvals.find((candidate) => candidate.id === id);
    if (!approval) return null;
    if (approval.status === "pending") {
      approval.status = decision;
      approval.decidedAt = new Date().toISOString();
    }
    return approval;
  });
}

// ---------- Tickets ----------

export function listTickets(customerId: string): Ticket[] {
  return read((state) =>
    newestFirst(
      state.tickets.filter((ticket) => ticket.customerId === customerId),
      (ticket) => ticket.updatedAt,
    ),
  );
}

export function createTicket(input: Omit<Ticket, "id" | "createdAt" | "updatedAt">): Ticket {
  return write((state) => {
    const highest = Math.max(20000, ...state.tickets.map((ticket) => Number(ticket.id.replace(/\D/g, "")) || 0));
    const now = new Date().toISOString();
    const ticket: Ticket = { ...input, id: `TCK-${highest + 1}`, createdAt: now, updatedAt: now };
    state.tickets.push(ticket);
    return ticket;
  });
}

export function updateTicket(id: string, patch: Partial<Omit<Ticket, "id" | "createdAt">>): Ticket | null {
  return write((state) => {
    const ticket = state.tickets.find((candidate) => candidate.id === id);
    if (!ticket) return null;
    Object.assign(ticket, patch, { updatedAt: new Date().toISOString() });
    return ticket;
  });
}

// ---------- Invoices ----------

export function getInvoice(id: string): Invoice | null {
  return read((state) => state.invoices.find((invoice) => invoice.id === id) ?? null);
}

export function markInvoiceSent(id: string, sentTo: string[]): Invoice | null {
  return write((state) => {
    const invoice = state.invoices.find((candidate) => candidate.id === id);
    if (!invoice) return null;
    invoice.sentAt = new Date().toISOString();
    invoice.sentTo = sentTo;
    return invoice;
  });
}
