import type {
  CallRecord,
  ConsoleState,
  Customer,
  Device,
  Dispute,
  Loan,
  Payout,
  ProfileKind,
  RentalCharge,
  Reward,
  Settlement,
  Ticket,
  UpiTransaction,
} from "@/lib/types";

/** Every collection of customer records in the console state. */
export type RecordBook = Pick<
  ConsoleState,
  | "customers"
  | "transactions"
  | "disputes"
  | "settlements"
  | "devices"
  | "rentalCharges"
  | "rewards"
  | "loans"
  | "payouts"
  | "tickets"
>;

export type RecordHit =
  | { type: "customer"; record: Customer }
  | { type: "transaction"; record: UpiTransaction }
  | { type: "dispute"; record: Dispute }
  | { type: "settlement"; record: Settlement }
  | { type: "device"; record: Device }
  | { type: "rentalCharge"; record: RentalCharge }
  | { type: "reward"; record: Reward }
  | { type: "loan"; record: Loan }
  | { type: "payout"; record: Payout }
  | { type: "ticket"; record: Ticket };

export type RecordType = RecordHit["type"];

/** Resolves an id a moment touched (record id, RRN or UTR) to the record it names. */
export function findRecord(book: RecordBook, id: string): RecordHit | undefined {
  const payout = book.payouts.find((p) => p.id === id);
  if (payout) return { type: "payout", record: payout };
  const dispute = book.disputes.find((d) => d.id === id);
  if (dispute) return { type: "dispute", record: dispute };
  const settlement = book.settlements.find((s) => s.id === id || s.utr === id);
  if (settlement) return { type: "settlement", record: settlement };
  const device = book.devices.find((d) => d.id === id);
  if (device) return { type: "device", record: device };
  const charge = book.rentalCharges.find((c) => c.id === id);
  if (charge) return { type: "rentalCharge", record: charge };
  const reward = book.rewards.find((r) => r.id === id);
  if (reward) return { type: "reward", record: reward };
  const ticket = book.tickets.find((t) => t.id === id);
  if (ticket) return { type: "ticket", record: ticket };
  const txn = book.transactions.find((t) => t.id === id || t.rrn === id);
  if (txn) return { type: "transaction", record: txn };
  const loan = book.loans.find((l) => l.id === id || l.deductions.some((d) => d.id === id));
  if (loan) return { type: "loan", record: loan };
  const customer = book.customers.find((c) => c.id === id);
  if (customer) return { type: "customer", record: customer };
  return undefined;
}

export function touchedRecords(book: RecordBook, touched: readonly string[] | undefined): RecordHit[] {
  const seen = new Set<string>();
  const out: RecordHit[] = [];
  for (const id of touched ?? []) {
    const hit = findRecord(book, id);
    if (!hit || seen.has(`${hit.type}:${hit.record.id}`)) continue;
    seen.add(`${hit.type}:${hit.record.id}`);
    out.push(hit);
  }
  return out;
}

/** Only the one customer's records, so nothing about anyone else can leak onto their screen. */
export function recordsFor(book: RecordBook, customerId: string | undefined): RecordBook {
  const mine = <T extends { customerId: string }>(rows: T[]) => (customerId ? rows.filter((r) => r.customerId === customerId) : []);
  return {
    customers: customerId ? book.customers.filter((c) => c.id === customerId) : [],
    transactions: mine(book.transactions),
    disputes: mine(book.disputes),
    settlements: mine(book.settlements),
    devices: mine(book.devices),
    rentalCharges: mine(book.rentalCharges),
    rewards: mine(book.rewards),
    loans: mine(book.loans),
    payouts: mine(book.payouts),
    tickets: mine(book.tickets),
  };
}

export const PROFILE_LABEL: Record<ProfileKind, string> = { consumer: "Consumer", merchant: "Merchant" };

export type Channel = NonNullable<CallRecord["channel"]>;

/** Records from before chat existed, and rows that omit it, are voice calls. */
export function channelOf(call: { channel?: unknown } | null | undefined): Channel {
  return call?.channel === "chat" ? "chat" : "voice";
}

/** The seeded customer each demo call is placed for; the seed lists the demo customer first for each kind. */
export function demoCustomer(customers: Customer[], kind: ProfileKind): Customer | undefined {
  return customers.find((c) => c.kind === kind);
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export const PAYOUT_KIND: Record<Payout["kind"], string> = {
  cashback: "Cashback",
  rent_refund: "Rent refund",
  settlement_retry: "Settlement retry",
};

/** EMI deductions that share a calendar month with another one: the "deducted twice" case. */
export function repeatedDeductions(loan: Loan): Set<string> {
  const byMonth = new Map<string, string[]>();
  for (const d of loan.deductions) {
    const month = d.at.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), d.id]);
  }
  return new Set([...byMonth.values()].filter((ids) => ids.length > 1).flat());
}

export function chargedAfterReturn(charge: RentalCharge, device: Device | undefined): boolean {
  const returnedAt = device?.rental.returnedAt;
  if (!returnedAt || charge.status !== "charged") return false;
  return Date.parse(charge.chargedAt) > Date.parse(returnedAt);
}

export function firmwareBehind(device: Device): boolean {
  const { firmware, latestFirmware } = device.health;
  return Boolean(firmware && latestFirmware && firmware !== latestFirmware);
}
