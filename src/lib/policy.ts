import {
  addHours,
  calendarDaysBetween,
  daysBetweenKeys,
  formatDateTime,
  formatLongDate,
  formatRupees,
  formatShortDate,
  hoursSince,
} from "@/lib/format";
import type { Address, Customer, Order, OrderStatus, PolicyDecision, Refund } from "@/lib/types";

export const RETURN_WINDOW_DAYS = 30;
export const QC_SLA_HOURS = 48;
export const AUTO_APPROVE_LIMIT = 5_000;
export const RESCHEDULE_WINDOW_DAYS = 7;
export const ESCALATION_CALLBACK_HOURS = 2;

/** The courier event that proves a reverse pickup happened; seed data and the pickup check share it. */
export const RETURN_PICKUP_SCAN = "Return picked up";

export const DELIVERY_SLOTS = [
  { label: "10 AM – 1 PM", startHour: 10, endHour: 13 },
  { label: "1 PM – 4 PM", startHour: 13, endHour: 16 },
  { label: "4 PM – 7 PM", startHour: 16, endHour: 19 },
  { label: "7 PM – 9 PM", startHour: 19, endHour: 21 },
] as const;

export type DeliverySlotLabel = (typeof DELIVERY_SLOTS)[number]["label"];

const RESCHEDULABLE: OrderStatus[] = ["placed", "shipped", "out_for_delivery"];
const ADDRESS_EDITABLE: OrderStatus[] = ["placed", "shipped"];

interface RuleResult {
  rule: string;
  passed: boolean;
  note: string;
  /** What a failure of this rule means: a hard stop, or a case a person should look at. */
  onFail: "deny" | "needs_approval";
}

function decide(results: RuleResult[], allowReasons: string[]): PolicyDecision {
  const failed = results.filter((result) => !result.passed);
  const blocking = failed.filter((result) => result.onFail === "deny");
  const review = failed.filter((result) => result.onFail === "needs_approval");

  const outcome = blocking.length > 0 ? "deny" : review.length > 0 ? "needs_approval" : "allow";
  const reasons =
    outcome === "deny"
      ? blocking.map((result) => result.note)
      : outcome === "needs_approval"
        ? review.map((result) => result.note)
        : allowReasons;

  return {
    outcome,
    reasons,
    checks: results.map(({ rule, passed, note }) => ({ rule, passed, note })),
  };
}

export function humanStatus(status: OrderStatus): string {
  return status.replace(/_/g, " ");
}

export function refundMethodFor(order: Order): string {
  switch (order.payment.method) {
    case "UPI":
      return "UPI (original source)";
    case "Card":
      return "Card (original source)";
    case "NetBanking":
      return "Bank account (original source)";
    case "COD":
      return "IMPS to bank account on file";
  }
}

export function refundSettlementBusinessDays(order: Order): number {
  return order.payment.method === "UPI" ? 3 : 5;
}

// ---------- Refunds ----------

function checkPickup(order: Order): RuleResult {
  const rule = "Return picked up by courier";
  const onFail = "deny";
  if (!order.return) return { rule, passed: false, note: "No return has been raised for this order", onFail };
  if (!order.return.pickedAt) return { rule, passed: false, note: "Return pickup hasn't happened yet", onFail };

  const scan = order.shipment.events.find((event) => event.status === RETURN_PICKUP_SCAN);
  if (!scan) return { rule, passed: false, note: "No courier scan confirms the pickup", onFail };
  return {
    rule,
    passed: true,
    note: `${order.shipment.courier} pickup scan on ${formatDateTime(scan.at)}`,
    onFail,
  };
}

function checkReturnWindow(order: Order, now: Date): RuleResult {
  const rule = `Raised within ${RETURN_WINDOW_DAYS} days of delivery`;
  const onFail = "deny";
  if (!order.deliveredAt) return { rule, passed: false, note: "Order hasn't been delivered", onFail };

  const raisedAt = order.return?.requestedAt ?? now;
  const days = calendarDaysBetween(order.deliveredAt, raisedAt);
  return days <= RETURN_WINDOW_DAYS
    ? { rule, passed: true, note: `Raised ${days} days after delivery`, onFail }
    : {
        rule,
        passed: false,
        note: `Raised ${days} days after delivery, outside the ${RETURN_WINDOW_DAYS}-day window`,
        onFail,
      };
}

function checkNoPriorRefund(order: Order, existingRefunds: Refund[]): RuleResult {
  const rule = "No refund already on this order";
  const onFail = "deny";
  const prior = existingRefunds.find((refund) => refund.orderId === order.id);
  if (!prior) return { rule, passed: true, note: "No earlier refund on this order", onFail };

  const note =
    prior.status === "processed"
      ? `Already refunded (${prior.id}) on ${formatShortDate(prior.createdAt)}`
      : prior.status === "pending_approval"
        ? `Refund ${prior.id} is already awaiting approval`
        : `A refund was reviewed and declined on ${formatShortDate(prior.createdAt)}`;
  return { rule, passed: false, note, onFail };
}

// A flag routes the case to a person instead of denying it: flags are heuristics, and a
// wrongly flagged customer with a genuine return should still get their money.
function checkAbuseFlags(customer: Customer): RuleResult {
  const rule = "No abuse flags on the account";
  return customer.flags.length === 0
    ? { rule, passed: true, note: "Clean account history", onFail: "needs_approval" }
    : {
        rule,
        passed: false,
        note: `Account flagged ${customer.flags.join(", ")}; a person must review instead of auto-approving`,
        onFail: "needs_approval",
      };
}

// Past the SLA the delay is ours, not the customer's, so the courier's pickup scan is
// enough proof to refund without waiting on the warehouse.
function checkQc(order: Order, now: Date): RuleResult {
  const rule = `QC passed, or pending past the ${QC_SLA_HOURS}h SLA`;
  const onFail = "deny";
  const returned = order.return;
  if (!returned) return { rule, passed: false, note: "No returned item to inspect", onFail };
  if (!returned.pickedAt) return { rule, passed: false, note: "Item hasn't reached the warehouse yet", onFail };

  switch (returned.qcStatus) {
    case "passed":
      return {
        rule,
        passed: true,
        note: `QC passed on ${formatShortDate(returned.qcSince ?? returned.pickedAt)}`,
        onFail,
      };
    case "failed":
      return { rule, passed: false, note: "Returned item failed the quality check", onFail };
    case "awaiting_pickup":
      return { rule, passed: false, note: "Item hasn't reached the warehouse yet", onFail };
    case "pending": {
      const since = returned.qcSince ?? returned.pickedAt;
      if (hoursSince(since, now) > QC_SLA_HOURS) {
        const days = calendarDaysBetween(since, now);
        return {
          rule,
          passed: true,
          note: `QC pending ${days} days, past the ${QC_SLA_HOURS}h SLA; refund released on pickup proof`,
          onFail,
        };
      }
      return {
        rule,
        passed: false,
        note: `Quality check in progress, due by ${formatDateTime(addHours(since, QC_SLA_HOURS))}`,
        onFail,
      };
    }
  }
}

function checkAutoApproveLimit(order: Order): RuleResult {
  const rule = `Within the ${formatRupees(AUTO_APPROVE_LIMIT)} auto-approve limit`;
  return order.total <= AUTO_APPROVE_LIMIT
    ? {
        rule,
        passed: true,
        note: `${formatRupees(order.total)} is within the ${formatRupees(AUTO_APPROVE_LIMIT)} auto-approve limit`,
        onFail: "needs_approval",
      }
    : {
        rule,
        passed: false,
        note: `${formatRupees(order.total)} is above the ${formatRupees(AUTO_APPROVE_LIMIT)} auto-approve limit`,
        onFail: "needs_approval",
      };
}

export function evaluateRefund(
  order: Order,
  customer: Customer,
  existingRefunds: Refund[],
  now: Date = new Date(),
): PolicyDecision {
  const pickup = checkPickup(order);
  const qc = checkQc(order, now);
  const limit = checkAutoApproveLimit(order);
  return decide(
    [
      pickup,
      checkReturnWindow(order, now),
      checkNoPriorRefund(order, existingRefunds),
      checkAbuseFlags(customer),
      qc,
      limit,
    ],
    [pickup.note, qc.note, limit.note],
  );
}

// ---------- Delivery changes ----------

export function evaluateReschedule(
  order: Order,
  request: { date: string; slot: string | null },
  today: string,
): PolicyDecision {
  const notDelivered: RuleResult = RESCHEDULABLE.includes(order.status)
    ? { rule: "Not yet delivered", passed: true, note: `Order is ${humanStatus(order.status)}`, onFail: "deny" }
    : {
        rule: "Not yet delivered",
        passed: false,
        note: `Order is already ${humanStatus(order.status)}`,
        onFail: "deny",
      };

  const daysOut = daysBetweenKeys(today, request.date);
  const windowRule = `Date within the next ${RESCHEDULE_WINDOW_DAYS} days`;
  const inWindow: RuleResult =
    daysOut < 1
      ? { rule: windowRule, passed: false, note: "Earliest possible date is tomorrow", onFail: "deny" }
      : daysOut > RESCHEDULE_WINDOW_DAYS
        ? {
            rule: windowRule,
            passed: false,
            note: `${formatLongDate(request.date)} is beyond the ${RESCHEDULE_WINDOW_DAYS}-day window`,
            onFail: "deny",
          }
        : { rule: windowRule, passed: true, note: `${formatLongDate(request.date)}`, onFail: "deny" };

  const offered = DELIVERY_SLOTS.some((slot) => slot.label === request.slot);
  const slotAvailable: RuleResult = offered
    ? { rule: "Slot offered by courier", passed: true, note: request.slot ?? "", onFail: "deny" }
    : {
        rule: "Slot offered by courier",
        passed: false,
        note: `Available slots are ${DELIVERY_SLOTS.map((slot) => slot.label).join(", ")}`,
        onFail: "deny",
      };

  return decide([notDelivered, inWindow, slotAvailable], [inWindow.note, slotAvailable.note]);
}

// Couriers can reroute inside a sorting district (the first three pincode digits);
// anything further away means cancelling and re-shipping, which a call shouldn't promise.
export function evaluateAddressChange(order: Order, address: Address): PolicyDecision {
  const stageRule = "Not yet out for delivery";
  const stage: RuleResult = ADDRESS_EDITABLE.includes(order.status)
    ? { rule: stageRule, passed: true, note: `Order is ${humanStatus(order.status)}`, onFail: "deny" }
    : {
        rule: stageRule,
        passed: false,
        note:
          order.status === "out_for_delivery"
            ? "Package is already with the delivery rider, so the address can't change today"
            : `Order is already ${humanStatus(order.status)}`,
        onFail: "deny",
      };

  const validPincode = /^[1-9]\d{5}$/.test(address.pincode);
  const pincode: RuleResult = validPincode
    ? { rule: "Valid pincode", passed: true, note: address.pincode, onFail: "deny" }
    : {
        rule: "Valid pincode",
        passed: false,
        note: `"${address.pincode}" is not a valid 6-digit pincode`,
        onFail: "deny",
      };

  const currentZone = order.address.pincode.slice(0, 3);
  const sameZone = validPincode && address.pincode.slice(0, 3) === currentZone;
  const zone: RuleResult = sameZone
    ? {
        rule: "Same delivery zone",
        passed: true,
        note: `${address.pincode} is in the same ${currentZone} delivery zone`,
        onFail: "deny",
      }
    : {
        rule: "Same delivery zone",
        passed: false,
        note: `${address.pincode} is outside the ${currentZone} delivery zone, which needs a fresh shipment`,
        onFail: "deny",
      };

  return decide([stage, pincode, zone], [zone.note]);
}
