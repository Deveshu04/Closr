import {
  addBusinessDays,
  atIst,
  calendarDaysBetween,
  endOfIstDay,
  formatDateTime,
  formatLongDate,
  formatMonth,
  formatRupees,
  formatShortDate,
  formatTime,
  istDateKey,
  lastDigits,
  shiftDateKey,
} from "@/lib/format";
import type { DeviceRecord } from "@/lib/seed";
import type { Customer, Loan, PolicyDecision, RentalCharge, Reward, Settlement, UpiTransaction } from "@/lib/types";

export const ESCALATION_CALLBACK_HOURS = 2;

// RBI's turn-around-time circular (DPSS.CO.PD No.629/02.01.014/2019-20) counts T as the calendar date of the
// transaction, and makes the bank pay the delay compensation on its own, without the customer complaining.
export const UPI_REVERSAL_TAT_DAYS = { p2p: 1, p2m: 5 } as const;
export const UPI_DELAY_COMPENSATION_PER_DAY = 100;
export const UDIR_RESOLUTION_WORKING_DAYS = { min: 3, max: 5 } as const;

export const CASHBACK_AUTO_LIMIT = 500;
export const CASHBACK_CLAIM_WINDOW_DAYS = 30;

export const SETTLEMENT_RETRY_AUTO_LIMIT = 50_000;
export const SETTLEMENT_MAX_RETRIES = 3;

export const RENT_REFUND_AUTO_LIMIT = 1_000;

/** Under the RBI Integrated Ombudsman Scheme a customer can escalate once the lender has had 30 days. */
export const LENDER_GRIEVANCE_DAYS = 30;

export const REPLACEMENT_DELIVERY_WORKING_DAYS = 2;

type OnFail = "deny" | "needs_approval";

interface RuleResult {
  rule: string;
  passed: boolean;
  note: string;
  /** What a failure of this rule means: a hard stop, or a case a person should look at. */
  onFail: OnFail;
}

function rule(name: string, onFail: OnFail = "deny") {
  return {
    pass: (note: string): RuleResult => ({ rule: name, passed: true, note, onFail }),
    fail: (note: string): RuleResult => ({ rule: name, passed: false, note, onFail }),
  };
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
    checks: results.map(({ rule: name, passed, note }) => ({ rule: name, passed, note })),
  };
}

function withinLimit(amount: number, limit: number, what: string): RuleResult {
  const check = rule(`Within the ${formatRupees(limit)} auto-approve limit`, "needs_approval");
  return amount <= limit
    ? check.pass(`${formatRupees(amount)} ${what} is within the ${formatRupees(limit)} limit`)
    : check.fail(`${formatRupees(amount)} ${what} is above the ${formatRupees(limit)} auto-approve limit`);
}

// A flag routes the case to a person instead of denying it: flags are heuristics, and a
// wrongly flagged customer with a genuine claim should still get their money.
function noRiskFlags(customer: Customer): RuleResult {
  const check = rule("No risk flags on the account", "needs_approval");
  return customer.flags.length === 0
    ? check.pass("Clean account history")
    : check.fail(`Account flagged ${customer.flags.join(", ")}; a specialist must review it`);
}

// ---------- UPI failed debits ----------

export function reversalTatDays(txn: Pick<UpiTransaction, "kind">): number {
  return UPI_REVERSAL_TAT_DAYS[txn.kind];
}

/** End of day T+1 (person to person) or T+5 (person to merchant), in IST. */
export function reversalDeadline(txn: Pick<UpiTransaction, "kind" | "at">): Date {
  return endOfIstDay(shiftDateKey(istDateKey(new Date(txn.at)), reversalTatDays(txn)));
}

export function reversalDaysLate(txn: UpiTransaction, now: Date = new Date()): number {
  const deadline = txn.reversal?.deadline ?? reversalDeadline(txn).toISOString();
  return Math.max(0, calendarDaysBetween(deadline, txn.reversal?.reversedAt ?? now));
}

export function bankCompensationDue(txn: UpiTransaction, now: Date = new Date()): number {
  return reversalDaysLate(txn, now) * UPI_DELAY_COMPENSATION_PER_DAY;
}

export function udirExpectedBy(raisedAt: Date): Date {
  return addBusinessDays(raisedAt, UDIR_RESOLUTION_WORKING_DAYS.max);
}

export function evaluateDispute(txn: UpiTransaction, bankName: string, now: Date = new Date()): PolicyDecision {
  const payee = txn.counterparty.name;
  const debit = rule("The caller's own debit");
  const stuck = rule("Money left the account but never reached the payee");
  const open = rule("No dispute already open on this payment");

  const results: RuleResult[] = [
    txn.direction === "debit"
      ? debit.pass(`${formatRupees(txn.amount)} paid to ${payee}`)
      : debit.fail("This is a payment the caller received; only the payer's bank can dispute it"),
  ];

  switch (txn.status) {
    case "debited_not_credited":
      results.push(stuck.pass(`Debited from ${bankName}, not credited to ${payee}`));
      break;
    case "pending":
      results.push(stuck.pass(`Still pending between ${bankName} and ${payee}'s bank`));
      break;
    case "reversed":
      results.push(
        stuck.fail(
          `Already reversed by ${bankName} on ${formatDateTime(txn.reversal?.reversedAt ?? txn.at)}` +
            (txn.reversal?.rrn ? ` (reversal ref ••${lastDigits(txn.reversal.rrn)})` : ""),
        ),
      );
      break;
    case "success":
      results.push(stuck.fail(`Completed: the money reached ${payee} (RRN ••${lastDigits(txn.rrn)})`));
      break;
    case "failed":
      results.push(stuck.fail("Failed before any money was debited; nothing to recover"));
      break;
  }

  results.push(txn.disputeId ? open.fail(`Dispute ${txn.disputeId} is already raised`) : open.pass("None raised yet"));

  const stillStuck = txn.status === "debited_not_credited" || txn.status === "pending";
  if (stillStuck) {
    const tat = reversalTatDays(txn);
    const deadline = txn.reversal?.deadline ?? reversalDeadline(txn).toISOString();
    const late = reversalDaysLate(txn, now);
    const clock = rule(`RBI turn-around time: auto-reversal by T+${tat}`);
    results.push(
      clock.pass(
        late > 0
          ? `${bankName} missed the ${formatShortDate(deadline)} deadline by ${late} day${late === 1 ? "" : "s"} and owes ` +
              `${formatRupees(late * UPI_DELAY_COMPENSATION_PER_DAY)} compensation, paid by the bank without a claim`
          : `${bankName} must reverse it by ${formatLongDate(deadline)}; after that the bank pays ` +
              `${formatRupees(UPI_DELAY_COMPENSATION_PER_DAY)} a day on its own`,
      ),
    );
  }

  const allowReasons = results.filter((result) => result.passed).slice(-1).map((result) => result.note);
  return decide(results, allowReasons);
}

// ---------- Cashback ----------

export function evaluateCashback(
  reward: Reward,
  txn: UpiTransaction | null,
  customer: Customer,
  now: Date = new Date(),
): PolicyDecision {
  const succeeded = rule("Qualifying payment succeeded");
  const valid = rule("Offer is valid");
  const notCredited = rule("Not already credited");
  const due = rule("Promised credit date has passed");
  const window = rule(`Claimed within ${CASHBACK_CLAIM_WINDOW_DAYS} days of the payment`);

  const daysSincePayment = txn ? calendarDaysBetween(txn.at, now) : Number.POSITIVE_INFINITY;
  const daysLate = calendarDaysBetween(reward.promisedBy, now);
  const limit = withinLimit(reward.amount, CASHBACK_AUTO_LIMIT, "cashback");

  return decide(
    [
      txn?.status === "success"
        ? succeeded.pass(`${formatRupees(txn.amount)} to ${txn.counterparty.name} on ${formatShortDate(txn.at)} succeeded`)
        : succeeded.fail(txn ? `The payment is ${txn.status.replace(/_/g, " ")}, so the offer never triggered` : "No qualifying payment on record"),
      reward.status === "expired" ? valid.fail(`${reward.offer} has expired`) : valid.pass(reward.offer),
      reward.status === "credited" || reward.payoutId
        ? notCredited.fail(`Already credited${reward.creditedAt ? ` on ${formatShortDate(reward.creditedAt)}` : ""}`)
        : notCredited.pass(reward.failureNote ? `Not credited: ${reward.failureNote}` : "Not credited yet"),
      new Date(reward.promisedBy) <= now
        ? due.pass(`Promised by ${formatShortDate(reward.promisedBy)}; ${daysLate} day${daysLate === 1 ? "" : "s"} late`)
        : due.fail(`On track: it is due by ${formatLongDate(reward.promisedBy)} and credits automatically`),
      daysSincePayment <= CASHBACK_CLAIM_WINDOW_DAYS
        ? window.pass(`Payment was ${daysSincePayment} days ago`)
        : window.fail(`Payment was more than ${CASHBACK_CLAIM_WINDOW_DAYS} days ago`),
      noRiskFlags(customer),
      limit,
    ],
    [limit.note],
  );
}

// ---------- Settlements ----------

const BANK_SIDE_FAILURES = new Set(["ACCOUNT_CLOSED", "ACCOUNT_FROZEN"]);

/** A risk hold is a fraud signal: no retry, no explanation on the call, a specialist takes it. */
export function settlementNeedsReview(settlement: Settlement): boolean {
  return settlement.status === "on_hold" || settlement.failure?.code === "RISK_HOLD";
}

export function settlementNeedsNewBank(settlement: Settlement): boolean {
  return settlement.failure !== undefined && BANK_SIDE_FAILURES.has(settlement.failure.code);
}

export function evaluateSettlementRetry(settlement: Settlement): PolicyDecision {
  const failed = rule("Settlement failed and has not been paid");
  const technical = rule("Failure was a technical bank timeout");
  const retries = rule(`Fewer than ${SETTLEMENT_MAX_RETRIES} retries so far`);
  const limit = withinLimit(settlement.amount, SETTLEMENT_RETRY_AUTO_LIMIT, "settlement");

  const statusCheck =
    settlement.status === "failed"
      ? failed.pass(`${formatRupees(settlement.amount)} for ${formatShortDate(settlement.forDate)} failed`)
      : settlement.status === "settled"
        ? failed.fail(
            `Already settled${settlement.settledAt ? ` on ${formatDateTime(settlement.settledAt)}` : ""}` +
              (settlement.utr ? `, UTR ••${lastDigits(settlement.utr)}` : ""),
          )
        : settlement.status === "processing"
          ? failed.fail("Already being processed by the bank")
          : failed.fail("Held by the risk team");

  const failure = settlement.failure;
  const causeCheck = !failure
    ? technical.fail("No failure reason on record")
    : failure.code === "BANK_TIMEOUT"
      ? technical.pass(`BANK_TIMEOUT: ${failure.note}`)
      : BANK_SIDE_FAILURES.has(failure.code)
        ? technical.fail(
            `${failure.code}: the bank account ••${settlement.bankLast4} can't receive money. The bank account can only be ` +
              "changed in the Paytm for Business app with verification, never on a call",
          )
        : technical.fail(`${failure.code}: ${failure.note}; a specialist must review it`);

  return decide(
    [
      statusCheck,
      causeCheck,
      settlement.retries < SETTLEMENT_MAX_RETRIES
        ? retries.pass(`${settlement.retries} retr${settlement.retries === 1 ? "y" : "ies"} so far`)
        : retries.fail(`Already retried ${settlement.retries} times; the bank needs to look at it`),
      limit,
    ],
    [causeCheck.note, limit.note],
  );
}

// ---------- Device rental ----------

function periodStart(period: string): Date {
  return atIst(`${period}-01`, 0);
}

/** Charges whose billing month began after the device was handed back. */
export function chargesAfterReturn(device: DeviceRecord, charges: RentalCharge[]): RentalCharge[] {
  const returnedAt = device.rental.returnedAt;
  if (!returnedAt) return [];
  return charges.filter(
    (charge) => charge.deviceId === device.id && periodStart(charge.period).getTime() > Date.parse(returnedAt),
  );
}

export interface RentRefundCheck {
  decision: PolicyDecision;
  refundable: RentalCharge[];
  amount: number;
}

export function evaluateRentRefund(device: DeviceRecord, charges: RentalCharge[]): RentRefundCheck {
  const returned = rule("Device returned with pickup proof");
  const afterReturn = rule("Rent charged for months after the return");
  const notRefunded = rule("Not already refunded");

  const late = chargesAfterReturn(device, charges);
  const refundable = late.filter((charge) => charge.status === "charged");
  const amount = refundable.reduce((sum, charge) => sum + charge.amount, 0);
  const months = refundable.map((charge) => `${formatMonth(charge.period)} ${formatRupees(charge.amount)}`).join(", ");
  const { returnedAt, pickupRef } = device.rental;
  const limit = withinLimit(amount, RENT_REFUND_AUTO_LIMIT, "refund");

  const decision = decide(
    [
      device.status === "returned" && returnedAt && pickupRef
        ? returned.pass(`Picked up ${formatDateTime(returnedAt)}, pickup ref ${pickupRef}`)
        : device.status === "returned"
          ? returned.fail("Marked returned but there is no pickup proof")
          : returned.fail(`${device.model} is still with the merchant, so its rent is due`),
      late.length > 0
        ? afterReturn.pass(late.map((charge) => formatMonth(charge.period)).join(" and ") + " were billed after the return")
        : afterReturn.fail(returnedAt ? `No rent was charged after ${formatShortDate(returnedAt)}` : "No return on record"),
      late.length > 0 && refundable.length === 0
        ? notRefunded.fail("Every charge after the return is already refunded")
        : notRefunded.pass(months || "Nothing refunded yet"),
      limit,
    ],
    [months ? `Refund ${months}` : "", limit.note].filter(Boolean),
  );
  return { decision, refundable, amount };
}

// ---------- Soundbox ----------

export type DeviceAction = "restart" | "firmware_update" | "test_announcement" | "replacement";

/** `unannounced` counts payments the device missed since it last restarted. */
export function evaluateDeviceAction(device: DeviceRecord, action: DeviceAction, unannounced: number): PolicyDecision {
  const inService = rule("Device is in service with the merchant");
  const results: RuleResult[] = [
    device.status === "returned"
      ? inService.fail(`Returned${device.rental.returnedAt ? ` on ${formatShortDate(device.rental.returnedAt)}` : ""}`)
      : inService.pass(`${device.model} on rental since ${formatShortDate(device.rental.startedAt)}`),
  ];
  const online = rule("Device is online to receive the command");
  const onlineCheck =
    device.status === "online"
      ? online.pass(`Last heartbeat ${formatTime(device.lastSeen)}`)
      : online.fail(`Offline since ${formatDateTime(device.lastSeen)}; restart it first`);

  switch (action) {
    case "restart": {
      const needed = rule("Offline or not announcing payments");
      results.push(
        device.status === "offline"
          ? needed.pass(`Offline since ${formatDateTime(device.lastSeen)}`)
          : unannounced > 0
            ? needed.pass(`${unannounced} payment${unannounced === 1 ? "" : "s"} not announced`)
            : needed.fail("Online and announcing normally; no restart needed"),
      );
      break;
    }
    case "firmware_update": {
      const behind = rule("Firmware is behind the latest release");
      results.push(
        onlineCheck,
        device.health.firmware !== device.health.latestFirmware
          ? behind.pass(`${device.health.firmware} → ${device.health.latestFirmware}`)
          : behind.fail(`Already on the latest firmware ${device.health.latestFirmware}`),
      );
      break;
    }
    case "test_announcement":
      results.push(onlineCheck);
      break;
    case "replacement": {
      const restartFailed = rule("A remote restart has failed");
      const last = device.lastRestart;
      results.push(
        last && !last.ok
          ? restartFailed.pass(`Restart at ${formatDateTime(last.at)} did not bring it back`)
          : last?.ok
            ? restartFailed.fail(`The restart at ${formatTime(last.at)} fixed it; no replacement needed`)
            : restartFailed.fail("No remote restart tried yet; restart it first"),
      );
      break;
    }
  }
  return decide(results, [results[results.length - 1].note]);
}

// ---------- Loans ----------

export interface DuplicateDeduction {
  day: string;
  amount: number;
  first: Loan["deductions"][number];
  repeat: Loan["deductions"][number];
}

/** A second deduction of the same amount on the same IST day is a double debit, whatever the mode. */
export function findDuplicateDeductions(loan: Loan): DuplicateDeduction[] {
  const seen = new Map<string, Loan["deductions"][number]>();
  const duplicates: DuplicateDeduction[] = [];
  const ordered = [...loan.deductions].sort((a, b) => a.at.localeCompare(b.at));
  for (const deduction of ordered) {
    const key = `${istDateKey(new Date(deduction.at))}:${deduction.amount}`;
    const first = seen.get(key);
    if (first) duplicates.push({ day: key.slice(0, 10), amount: deduction.amount, first, repeat: deduction });
    else seen.set(key, deduction);
  }
  return duplicates;
}

export function lenderResolutionDue(raisedAt: Date): Date {
  return endOfIstDay(shiftDateKey(istDateKey(raisedAt), LENDER_GRIEVANCE_DAYS));
}

// Paytm is the lending service provider, not the lender: the money sits on the lender's books, so only the
// lender can refund it. Closr's job is to put the case in front of the lender's grievance officer with proof.
export function evaluateLenderGrievance(loan: Loan, duplicates: DuplicateDeduction[], now: Date = new Date()): PolicyDecision {
  const due = lenderResolutionDue(now);
  const proof = duplicates[0];
  return decide(
    [
      rule("Loan is on a regulated lender's books").pass(`${loan.lender} is the lender; Paytm is the lending service provider`),
      rule("Refunds of lender money are the lender's decision").pass(
        "Paytm cannot reverse a loan deduction; the case goes to the lender's grievance officer",
      ),
      rule("Deduction record checked").pass(
        proof
          ? `${formatRupees(proof.amount)} taken twice on ${formatShortDate(proof.day)} ` +
              `(RRN ••${lastDigits(proof.first.rrn)} and ••${lastDigits(proof.repeat.rrn)})`
          : "No duplicate in the deduction record; the customer's account of the issue is forwarded as stated",
      ),
      rule(`Lender must resolve within ${LENDER_GRIEVANCE_DAYS} days`).pass(
        `Reply due by ${formatLongDate(due)}; after that the customer can approach the RBI Ombudsman`,
      ),
    ],
    [`Route to ${loan.grievanceOfficer.name}, reply due by ${formatShortDate(due)}`],
  );
}
