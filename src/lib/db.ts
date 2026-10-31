import fs from "node:fs";
import path from "node:path";
import { normalizePhone } from "@/lib/format";
import { voiceSafeId } from "@/lib/ids";
import { chargesAfterReturn } from "@/lib/policy";
import { createSeed, DEMO_PROFILES, type DeviceRecord, type SeedData } from "@/lib/seed";
import type {
  Approval,
  AutonomyLevel,
  CallRecord,
  ConsoleState,
  Customer,
  Dispute,
  FollowUp,
  Lesson,
  Loan,
  Moment,
  Offer,
  Payout,
  ProfileKind,
  RentalCharge,
  Reward,
  Settlement,
  Ticket,
  UpiTransaction,
  Workflow,
} from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "db.json");
/** Bump when the stored shape or seed story changes, so an old db.json is re-seeded instead of misread. */
const SCHEMA_VERSION = 6;
const MOMENT_HISTORY_LIMIT = 1000;

interface DbState extends SeedData {
  version: number;
  seededAt: string;
  activeCallRef: string | null;
  calls: CallRecord[];
  moments: Moment[];
  approvals: Approval[];
  autonomy: Record<Workflow, AutonomyLevel>;
  lessons: Lesson[];
  followUps: FollowUp[];
}

export const DEFAULT_AUTONOMY: Record<Workflow, AutonomyLevel> = { cashback: 2, rent_refunds: 2, settlement_retries: 2 };

function freshState(): DbState {
  return {
    version: SCHEMA_VERSION,
    seededAt: new Date().toISOString(),
    activeCallRef: null,
    calls: [],
    moments: [],
    approvals: [],
    autonomy: { ...DEFAULT_AUTONOMY },
    lessons: [],
    followUps: [],
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

function byId<T extends { id: string }>(items: T[], id: string): T | null {
  return items.find((item) => item.id === id) ?? null;
}

function samePhone(a: string, b: string): boolean {
  const left = normalizePhone(a);
  return left !== "" && left === normalizePhone(b);
}

/** Re-seeds the demo data but keeps past calls and their moments: transcripts are the review record. */
/** Re-seeds the demo data but keeps call history, autonomy settings and lessons unless asked to clear them. */
export function resetDb({ keepHistory = true }: { keepHistory?: boolean } = {}): void {
  if (!keepHistory) return save(freshState());
  const kept = read(({ calls, moments, autonomy, lessons }) => ({ calls, moments, autonomy, lessons }));
  save({ ...freshState(), ...kept });
}

export function getState(): ConsoleState {
  return read((state) => {
    const call = state.calls.find((candidate) => candidate.callRef === state.activeCallRef) ?? null;
    return {
      call,
      moments: call ? state.moments.filter((moment) => moment.callRef === call.callRef) : [],
      approvals: newestFirst(state.approvals, (approval) => approval.createdAt),
      customers: state.customers,
      transactions: newestFirst(state.transactions, (txn) => txn.at),
      disputes: newestFirst(state.disputes, (dispute) => dispute.raisedAt),
      settlements: newestFirst(state.settlements, (settlement) => settlement.forDate),
      devices: state.devices,
      rentalCharges: newestFirst(state.rentalCharges, (charge) => charge.chargedAt),
      rewards: newestFirst(state.rewards, (reward) => reward.promisedBy),
      loans: state.loans,
      payouts: newestFirst(state.payouts, (payout) => payout.createdAt),
      tickets: newestFirst(state.tickets, (ticket) => ticket.updatedAt),
      autonomy: state.autonomy,
      lessons: newestFirst(state.lessons, (lesson) => lesson.createdAt),
      offers: state.offers,
      followUps: newestFirst(state.followUps, (followUp) => followUp.dueAt),
    };
  });
}

// ---------- Autonomy and lessons ----------

export function getAutonomy(): Record<Workflow, AutonomyLevel> {
  return read((state) => state.autonomy);
}

export function setAutonomy(workflow: Workflow, level: AutonomyLevel): Record<Workflow, AutonomyLevel> {
  return write((state) => {
    state.autonomy[workflow] = level;
    return state.autonomy;
  });
}

export function listLessons(): Lesson[] {
  return read((state) => newestFirst(state.lessons, (lesson) => lesson.createdAt));
}

export function addLesson(text: string, sourceCallRef?: string): Lesson {
  return write((state) => {
    const lesson: Lesson = { id: voiceSafeId("LSN"), text, createdAt: new Date().toISOString(), sourceCallRef };
    state.lessons.push(lesson);
    return lesson;
  });
}

export function deleteLesson(id: string): boolean {
  return write((state) => {
    const before = state.lessons.length;
    state.lessons = state.lessons.filter((lesson) => lesson.id !== id);
    return state.lessons.length < before;
  });
}

// ---------- Follow-ups ----------

/** One check-back per dispute, so a repeated tool call can't schedule it twice. */
export function scheduleFollowUpOnce(input: Omit<FollowUp, "id" | "status">): FollowUp {
  return write((state) => {
    const existing = state.followUps.find((followUp) => followUp.disputeId === input.disputeId);
    if (existing) return existing;
    const followUp: FollowUp = { ...input, id: voiceSafeId("FUP"), status: "scheduled" };
    state.followUps.push(followUp);
    return followUp;
  });
}

export function listFollowUps(status?: FollowUp["status"]): FollowUp[] {
  return read((state) => state.followUps.filter((followUp) => !status || followUp.status === status));
}

export function completeFollowUp(id: string, outcome: string): FollowUp | null {
  return write((state) => {
    const followUp = byId(state.followUps, id);
    if (!followUp || followUp.status === "done") return null;
    Object.assign(followUp, { status: "done", outcome, doneAt: new Date().toISOString() });
    return followUp;
  });
}

/** Settles a disputed payment as reversed by the bank, as the dispute's resolution would. */
export function reverseDisputedPayment(txnId: string, disputeId: string, rrn: string): UpiTransaction | null {
  return write((state) => {
    const txn = byId(state.transactions, txnId);
    const dispute = byId(state.disputes, disputeId);
    if (!txn || !dispute) return null;
    const now = new Date().toISOString();
    txn.status = "reversed";
    txn.reversal = { deadline: txn.reversal?.deadline ?? now, reversedAt: now, rrn };
    dispute.status = "resolved";
    return txn;
  });
}

// ---------- Offers ----------

export function listOffers(customerId: string): Offer[] {
  return read((state) => state.offers.filter((offer) => offer.customerId === customerId));
}

export function updateOffer(id: string, patch: Partial<Omit<Offer, "id" | "customerId">>): Offer | null {
  return write((state) => {
    const offer = byId(state.offers, id);
    if (!offer) return null;
    Object.assign(offer, patch);
    return offer;
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

export function listCalls(): CallRecord[] {
  return read((state) => newestFirst(state.calls, (call) => call.startedAt));
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

/** Every conversation's moments grouped by call, in one read of the store. */
export function momentsByCall(): Map<string, Moment[]> {
  return read((state) => {
    const grouped = new Map<string, Moment[]>();
    for (const moment of state.moments) grouped.set(moment.callRef, [...(grouped.get(moment.callRef) ?? []), moment]);
    return grouped;
  });
}

export function listMoments(callRef: string): Moment[] {
  return read((state) => state.moments.filter((moment) => moment.callRef === callRef));
}

// ---------- Customers ----------

export function getCustomer(id: string): Customer | null {
  return read((state) => byId(state.customers, id));
}

export function findCustomerByPhone(phone: string): Customer | null {
  return read((state) => state.customers.find((customer) => samePhone(customer.phone, phone)) ?? null);
}

/**
 * Points the verified number at the demo profile the console chose. Both profiles are demoed on the
 * same phone, so the other one is parked on its placeholder and the number resolves to exactly one.
 */
export function claimDemoCustomer(phone: string, kind: ProfileKind): Customer {
  return write((state) => {
    let chosen: Customer | null = null;
    for (const [profile, demo] of Object.entries(DEMO_PROFILES)) {
      const customer = byId(state.customers, demo.id);
      if (!customer) continue;
      if (profile === kind) {
        customer.phone = normalizePhone(phone);
        chosen = customer;
      } else {
        customer.phone = demo.placeholderPhone;
      }
    }
    if (!chosen) throw new Error(`Seed data has no demo ${kind} profile`);
    return chosen;
  });
}

// ---------- UPI transactions and disputes ----------

export function getTransaction(id: string): UpiTransaction | null {
  return read((state) => byId(state.transactions, id));
}

export function listTransactions(customerId: string): UpiTransaction[] {
  return read((state) =>
    newestFirst(
      state.transactions.filter((txn) => txn.customerId === customerId),
      (txn) => txn.at,
    ),
  );
}

export function getDispute(id: string): Dispute | null {
  return read((state) => byId(state.disputes, id));
}

/**
 * One dispute per transaction. The check, the insert and the link back to the transaction share
 * a single write, so two overlapping requests can't raise two disputes.
 */
export function raiseDisputeOnce(dispute: Dispute): { dispute: Dispute; created: boolean } | null {
  return write((state) => {
    const txn = byId(state.transactions, dispute.txnId);
    if (!txn) return null;
    const existing = txn.disputeId ? byId(state.disputes, txn.disputeId) : null;
    if (existing) return { dispute: existing, created: false };
    state.disputes.push(dispute);
    txn.disputeId = dispute.id;
    return { dispute, created: true };
  });
}

/** Flags a payment the bank marked successful and opens its dispute in one write; a second call returns the first flag. */
export function flagTransactionOnce(
  txnId: string,
  reason: string,
  dispute: Dispute,
): { txn: UpiTransaction; dispute: Dispute; created: boolean } | null {
  return write((state) => {
    const txn = byId(state.transactions, txnId);
    if (!txn) return null;
    const existing = txn.disputeId ? byId(state.disputes, txn.disputeId) : null;
    if (txn.status === "flagged" && existing) return { txn, dispute: existing, created: false };
    txn.flag = { reason, flaggedAt: new Date().toISOString(), previousStatus: txn.status };
    txn.status = "flagged";
    state.disputes.push(dispute);
    txn.disputeId = dispute.id;
    return { txn, dispute, created: true };
  });
}

// ---------- Rewards and loans ----------

export function getReward(id: string): Reward | null {
  return read((state) => byId(state.rewards, id));
}

export function listRewards(customerId: string): Reward[] {
  return read((state) =>
    newestFirst(
      state.rewards.filter((reward) => reward.customerId === customerId),
      (reward) => reward.promisedBy,
    ),
  );
}

export function getLoan(id: string): Loan | null {
  return read((state) => byId(state.loans, id));
}

export function listLoans(customerId: string): Loan[] {
  return read((state) => state.loans.filter((loan) => loan.customerId === customerId));
}

// ---------- Settlements ----------

export function getSettlement(id: string): Settlement | null {
  return read((state) => byId(state.settlements, id));
}

/** Newest business day first. */
export function listSettlements(customerId: string): Settlement[] {
  return read((state) =>
    newestFirst(
      state.settlements.filter((settlement) => settlement.customerId === customerId),
      (settlement) => settlement.forDate,
    ),
  );
}

// ---------- Devices and rent ----------

export function getDevice(id: string): DeviceRecord | null {
  return read((state) => byId(state.devices, id));
}

export function listDevices(customerId: string): DeviceRecord[] {
  return read((state) => state.devices.filter((device) => device.customerId === customerId));
}

export function updateDevice(id: string, patch: Partial<Omit<DeviceRecord, "id" | "customerId">>): DeviceRecord | null {
  return write((state) => {
    const device = byId(state.devices, id);
    if (!device) return null;
    Object.assign(device, patch);
    return device;
  });
}

/** Oldest billing month first. */
export function listRentalCharges(deviceId: string): RentalCharge[] {
  return read((state) =>
    state.rentalCharges
      .filter((charge) => charge.deviceId === deviceId)
      .sort((a, b) => a.period.localeCompare(b.period)),
  );
}

// ---------- Payouts ----------

// A payout and its effect on the subject land in the same write, so the ledger can never say
// "paid" while the cashback, rent or settlement it paid for still looks unpaid.
function applyPayout(state: DbState, payout: Payout): void {
  const now = new Date().toISOString();
  switch (payout.kind) {
    case "cashback": {
      const reward = byId(state.rewards, payout.subjectId);
      if (reward) Object.assign(reward, { status: "credited", creditedAt: now, payoutId: payout.id });
      return;
    }
    case "rent_refund": {
      const device = byId(state.devices, payout.subjectId);
      if (!device) return;
      for (const charge of chargesAfterReturn(device, state.rentalCharges)) {
        if (charge.status !== "charged") continue;
        charge.status = "refunded";
        charge.payoutId = payout.id;
      }
      device.rental.billingActive = false;
      return;
    }
    case "settlement_retry": {
      const settlement = byId(state.settlements, payout.subjectId);
      if (!settlement) return;
      Object.assign(settlement, { status: "settled", utr: payout.rrn, settledAt: now, retries: settlement.retries + 1 });
      delete settlement.failure;
      return;
    }
  }
}

export function getPayout(id: string): Payout | null {
  return read((state) => byId(state.payouts, id));
}

export function findPayout(kind: Payout["kind"], subjectId: string): Payout | null {
  return read((state) => state.payouts.find((payout) => payout.kind === kind && payout.subjectId === subjectId) ?? null);
}

/** One payout per idempotency key; a repeat returns the first record untouched. */
export function recordPayout(payout: Payout): { payout: Payout; created: boolean } {
  return write((state) => {
    const existing = state.payouts.find((candidate) => candidate.idempotencyKey === payout.idempotencyKey);
    if (existing) return { payout: existing, created: false };
    state.payouts.push(payout);
    if (payout.status === "processed") applyPayout(state, payout);
    return { payout, created: true };
  });
}

/** Moves a payout out of pending_approval; returns null if it was already settled. */
export function settlePayout(
  id: string,
  outcome: { status: "processed"; rrn: string; expectedBy?: string } | { status: "rejected" },
): Payout | null {
  return write((state) => {
    const payout = byId(state.payouts, id);
    if (!payout || payout.status !== "pending_approval") return null;
    Object.assign(payout, outcome);
    if (outcome.status === "processed") applyPayout(state, payout);
    return payout;
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
  return read((state) => byId(state.approvals, id));
}

/** Only a pending approval changes; deciding twice returns the first decision untouched. */
export function decideApproval(id: string, decision: "approved" | "denied"): Approval | null {
  return write((state) => {
    const approval = byId(state.approvals, id);
    if (!approval) return null;
    if (approval.status === "pending") {
      approval.status = decision;
      approval.decidedAt = new Date().toISOString();
    }
    return approval;
  });
}

// ---------- Tickets ----------

export function getTicket(id: string): Ticket | null {
  return read((state) => byId(state.tickets, id));
}

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
    const ticket = byId(state.tickets, id);
    if (!ticket) return null;
    Object.assign(ticket, patch, { updatedAt: new Date().toISOString() });
    return ticket;
  });
}
