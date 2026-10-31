export type SystemName = "crm" | "orders" | "courier" | "payments" | "helpdesk" | "policy" | "web";

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

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  language: "hinglish" | "hindi" | "english";
  tier: "new" | "regular" | "vip";
  flags: string[];
  lifetimeValue: number;
}

export interface LineItem {
  sku: string;
  name: string;
  qty: number;
  price: number;
}

export type OrderStatus =
  | "placed"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "return_requested"
  | "return_picked"
  | "refunded"
  | "cancelled";

export interface ShipmentEvent {
  at: string;
  status: string;
  location: string;
}

export interface Shipment {
  courier: string;
  awb: string;
  status: string;
  eta?: string;
  slot?: string;
  events: ShipmentEvent[];
}

export interface ReturnInfo {
  reason: string;
  requestedAt: string;
  pickedAt?: string;
  qcStatus: "awaiting_pickup" | "pending" | "passed" | "failed";
  qcSince?: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  pincode: string;
}

export interface Order {
  id: string;
  customerId: string;
  items: LineItem[];
  total: number;
  status: OrderStatus;
  placedAt: string;
  deliveredAt?: string;
  address: Address;
  payment: { method: "UPI" | "Card" | "COD" | "NetBanking"; ref: string };
  shipment: Shipment;
  return?: ReturnInfo;
  invoiceId?: string;
}

export interface Invoice {
  id: string;
  number: string;
  orderId: string;
  customerId: string;
  issuedAt: string;
  subtotal: number;
  gst: number;
  total: number;
  gstin: string;
  /** Set when a copy was sent to the customer; channels like "email", "whatsapp". */
  sentAt?: string;
  sentTo?: string[];
}

export interface Refund {
  id: string;
  orderId: string;
  amount: number;
  status: "processed" | "pending_approval" | "rejected";
  method: string;
  idempotencyKey: string;
  createdAt: string;
  utr?: string;
  expectedBy?: string;
}

export interface Ticket {
  id: string;
  customerId: string;
  orderId?: string;
  subject: string;
  status: "open" | "resolved" | "escalated";
  priority: "low" | "normal" | "high";
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  callRef: string;
  orderId: string;
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
  orders: Order[];
  refunds: Refund[];
  tickets: Ticket[];
  invoices: Invoice[];
}
