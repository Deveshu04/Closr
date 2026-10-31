export type SystemName =
  | "crm"
  | "upi"
  | "settlements"
  | "devices"
  | "billing"
  | "rewards"
  | "lending"
  | "payouts"
  | "helpdesk"
  | "policy"
  | "web";

export type MomentKind =
  | "call"
  | "understood"
  | "lookup"
  | "policy"
  | "action"
  | "verified"
  | "approval"
  | "search"
  | "escalated";

export type MomentStatus = "running" | "ok" | "waiting" | "blocked" | "failed";

/** One visible step the agent took — the bridge between what it said and what it did. */
export interface Moment {
  id: string;
  callRef: string;
  kind: MomentKind;
  system?: SystemName;
  title: string;
  detail?: string;
  status: MomentStatus;
  /** Ids of records this step created or changed, so the console can highlight them. */
  touched?: string[];
  data?: Record<string, unknown>;
  at: string;
}

export type ProfileKind = "consumer" | "merchant";

export interface BankAccount {
  bank: string;
  last4: string;
  ifsc: string;
  status: "active" | "closed" | "frozen";
}

export interface Customer {
  id: string;
  kind: ProfileKind;
  name: string;
  phone: string;
  email: string;
  city: string;
  language: "hinglish" | "hindi" | "english";
  /** On Paytm since. */
  since: string;
  kyc: "full" | "minimum";
  upiHandle: string;
  /** Consumer: the UPI-linked account. Merchant: the settlement account. */
  bank: BankAccount;
  flags: string[];
  business?: { name: string; mid: string; category: string; address: string };
}

export type TxnStatus = "success" | "failed" | "pending" | "debited_not_credited" | "reversed";

export interface UpiTransaction {
  id: string;
  customerId: string;
  direction: "debit" | "credit";
  kind: "p2p" | "p2m";
  amount: number;
  counterparty: { name: string; vpa: string };
  status: TxnStatus;
  /** 12-digit UPI reference number (RRN/UTR). */
  rrn: string;
  at: string;
  /** RBI turn-around time for a debit that never reached the beneficiary. */
  reversal?: { deadline: string; reversedAt?: string; rrn?: string };
  disputeId?: string;
  /** Merchant collections: the Soundbox that should have announced it, and whether it did. */
  deviceId?: string;
  announced?: boolean;
}

export interface Dispute {
  id: string;
  customerId: string;
  txnId: string;
  channel: "UDIR";
  reason: string;
  status: "raised" | "in_review" | "resolved";
  raisedAt: string;
  expectedBy: string;
}

export interface Settlement {
  id: string;
  customerId: string;
  /** The business day whose collections this settles. */
  forDate: string;
  amount: number;
  txnCount: number;
  status: "settled" | "failed" | "on_hold" | "processing";
  bankLast4: string;
  utr?: string;
  settledAt?: string;
  failure?: { code: "BANK_TIMEOUT" | "ACCOUNT_CLOSED" | "ACCOUNT_FROZEN" | "RISK_HOLD"; note: string };
  retries: number;
}

export interface Device {
  /** Serial number. */
  id: string;
  customerId: string;
  model: string;
  status: "online" | "offline" | "returned";
  lastSeen: string;
  health: {
    signal: "good" | "weak" | "none";
    battery: number;
    firmware: string;
    latestFirmware: string;
    sim: string;
    volume: number;
  };
  rental: {
    monthly: number;
    deposit: number;
    startedAt: string;
    returnedAt?: string;
    pickupRef?: string;
    billingActive: boolean;
  };
}

export interface RentalCharge {
  id: string;
  customerId: string;
  deviceId: string;
  /** Billing month, e.g. "2026-09". */
  period: string;
  amount: number;
  chargedAt: string;
  status: "charged" | "refunded";
  payoutId?: string;
}

export interface Reward {
  id: string;
  customerId: string;
  txnId: string;
  offer: string;
  amount: number;
  status: "credited" | "pending" | "failed" | "expired";
  promisedBy: string;
  creditedAt?: string;
  payoutId?: string;
  failureNote?: string;
}

export interface Loan {
  id: string;
  customerId: string;
  lender: string;
  product: "personal" | "merchant";
  principal: number;
  outstanding: number;
  repayment: { mode: "emi" | "daily"; amount: number; dueDay?: number };
  deductions: { id: string; at: string; amount: number; rrn: string }[];
  grievanceOfficer: { name: string; email: string };
}

/** Money Closr moves on Paytm's side. One record per subject, so a double turn on the call can never pay twice. */
export interface Payout {
  id: string;
  customerId: string;
  kind: "cashback" | "rent_refund" | "settlement_retry";
  /** The reward, device or settlement this payout is for. */
  subjectId: string;
  amount: number;
  status: "processed" | "pending_approval" | "rejected";
  idempotencyKey: string;
  createdAt: string;
  rrn?: string;
  expectedBy?: string;
}

export interface Ticket {
  id: string;
  customerId: string;
  category: "upi" | "settlement" | "device" | "billing" | "rewards" | "loan" | "other";
  relatedId?: string;
  subject: string;
  status: "open" | "resolved" | "escalated";
  priority: "low" | "normal" | "high";
  /** Set when the case is routed outside Paytm, e.g. to a lender's grievance officer. */
  routedTo?: string;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  callRef: string;
  customerId: string;
  kind: Payout["kind"];
  subjectId: string;
  amount: number;
  reason: string;
  /** Short brief a human can decide on in one glance. */
  brief: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  decidedAt?: string;
}

export interface CallRecord {
  callRef: string;
  phone: string;
  customerId?: string;
  bolnaExecutionId?: string;
  status: "dialing" | "ringing" | "in_progress" | "completed" | "failed";
  startedAt: string;
  endedAt?: string;
  /** Talk time as billed by the telephony provider, once Bolna reports it. */
  durationSec?: number;
  transcript?: string;
  summary?: string;
}

export interface PolicyDecision {
  outcome: "allow" | "needs_approval" | "deny";
  reasons: string[];
  checks: { rule: string; passed: boolean; note: string }[];
}

/** Everything the console needs, served by GET /api/state and polled. */
export interface ConsoleState {
  call: CallRecord | null;
  moments: Moment[];
  approvals: Approval[];
  customers: Customer[];
  transactions: UpiTransaction[];
  disputes: Dispute[];
  settlements: Settlement[];
  devices: Device[];
  rentalCharges: RentalCharge[];
  rewards: Reward[];
  loans: Loan[];
  payouts: Payout[];
  tickets: Ticket[];
}
