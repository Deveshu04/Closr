import { atIst, istDateKey, monthKey, normalizePhone, shiftDateKey, shiftMonthKey } from "@/lib/format";
import { payoutKey, stableDigits, upiRrn } from "@/lib/ids";
import { reversalDeadline, udirExpectedBy } from "@/lib/policy";
import type {
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

/** What the device simulator needs beyond the console's view of a Soundbox. */
export interface DeviceRecord extends Device {
  /** A hardware fault that a remote restart cannot clear. */
  fault?: string;
  lastRestart?: { at: string; ok: boolean };
  lastAnnouncement?: { at: string; amount: number };
}

export interface SeedData {
  customers: Customer[];
  transactions: UpiTransaction[];
  disputes: Dispute[];
  settlements: Settlement[];
  devices: DeviceRecord[];
  rentalCharges: RentalCharge[];
  rewards: Reward[];
  loans: Loan[];
  payouts: Payout[];
  tickets: Ticket[];
}

export const DEMO_CONSUMER_ID = "CUST-1001";
export const DEMO_MERCHANT_ID = "MER-2001";

/** Both demo profiles are called on the one verified phone, so the profile not being demoed parks on a placeholder. */
export const DEMO_PROFILES: Record<ProfileKind, { id: string; placeholderPhone: string }> = {
  consumer: { id: DEMO_CONSUMER_ID, placeholderPhone: "+919999999999" },
  merchant: { id: DEMO_MERCHANT_ID, placeholderPhone: "+919999999998" },
};

/** The story beats the voice demo relies on. */
export const DEMO_RECORDS = {
  failedMerchantPayment: "TXN-60412",
  reversedTransfer: "TXN-60388",
  billCashback: "RWD-3107",
  flightCashback: "RWD-3094",
  personalLoan: "PL-48817",
  offlineSoundbox: "SB5-24108173",
  failedSettlement: "STL-90730",
  returnedSoundbox: "CSB-23060462",
  merchantLoan: "ML-71408",
} as const;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

interface SeedClock {
  now: Date;
  today: string;
  /** IST wall-clock time `daysAgo` days back, never later than five minutes ago. */
  at(daysAgo: number, hour: number, minute?: number): string;
  clamp(epochMs: number): string;
  /** "YYYY-MM" for `monthsBack` months ago. */
  month(monthsBack: number): string;
  onMonthDay(monthsBack: number, day: number, hour: number, minute?: number): string;
}

function seedClock(now: Date): SeedClock {
  const today = istDateKey(now);
  const latest = now.getTime() - 5 * MINUTE_MS;
  const clamp = (epochMs: number) => new Date(Math.min(epochMs, latest)).toISOString();
  const month = (monthsBack: number) => shiftMonthKey(monthKey(now), -monthsBack);
  return {
    now,
    today,
    clamp,
    month,
    at: (daysAgo, hour, minute = 0) => clamp(atIst(shiftDateKey(today, -daysAgo), hour, minute).getTime()),
    onMonthDay: (monthsBack, day, hour, minute = 0) =>
      clamp(atIst(`${month(monthsBack)}-${String(day).padStart(2, "0")}`, hour, minute).getTime()),
  };
}

function txn(input: Omit<UpiTransaction, "rrn"> & { rrn?: string }): UpiTransaction {
  return { ...input, rrn: input.rrn ?? upiRrn(new Date(input.at), stableDigits(input.id, 6)) };
}

function rrnAt(iso: string, seed: string): string {
  return upiRrn(new Date(iso), stableDigits(seed, 6));
}

function emailFromName(name: string): string {
  const handle = name.trim().toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
  return `${handle || "customer"}@gmail.com`;
}

function cashbackPayout(reward: Reward, id: string, at: string): Payout {
  return {
    id,
    customerId: reward.customerId,
    kind: "cashback",
    subjectId: reward.id,
    amount: reward.amount,
    status: "processed",
    idempotencyKey: payoutKey("cashback", reward.id),
    createdAt: at,
    rrn: rrnAt(at, id),
  };
}

function monthlyCharges(
  clock: SeedClock,
  device: DeviceRecord,
  monthsBack: number[],
  firstChargedAt?: string,
): RentalCharge[] {
  return monthsBack.map((back, index) => {
    const period = clock.month(back);
    return {
      id: `RNT-${period.replace("-", "")}-${device.id.slice(-4)}`,
      customerId: device.customerId,
      deviceId: device.id,
      period,
      amount: device.rental.monthly,
      chargedAt: index === 0 && firstChargedAt ? firstChargedAt : clock.onMonthDay(back, 1, 6),
      status: "charged",
    };
  });
}

// ---------- Consumer demo: a Delhi professional paying for everyday life on Paytm UPI ----------

function seedConsumerDemo(seed: SeedData, clock: SeedClock): void {
  const name = process.env.DEMO_CUSTOMER_NAME?.trim() || "Deveshu Pathak";
  const handle = name.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "") || "customer";
  const id = DEMO_CONSUMER_ID;

  seed.customers.push({
    id,
    kind: "consumer",
    name,
    phone: normalizePhone(process.env.DEMO_CUSTOMER_PHONE?.trim() || DEMO_PROFILES.consumer.placeholderPhone),
    email: process.env.DEMO_CUSTOMER_EMAIL?.trim() || emailFromName(name),
    city: "New Delhi",
    language: "hinglish",
    since: "2017-03-14",
    kyc: "full",
    upiHandle: `${handle}@ptsbi`,
    bank: { bank: "SBI", last4: "4821", ifsc: "SBIN0005943", status: "active" },
    flags: [],
  });

  const failedAt = clock.at(1, 19, 42);
  const transferAt = clock.at(4, 13, 15);
  const reversedAt = clock.at(3, 10, 20);
  const billAt = clock.at(9, 10, 20);
  const flightAt = clock.at(12, 21, 10);
  const debit = { customerId: id, direction: "debit" as const, status: "success" as const };

  seed.transactions.push(
    txn({
      ...debit,
      id: DEMO_RECORDS.failedMerchantPayment,
      kind: "p2m",
      amount: 2000,
      counterparty: { name: "Sharma Medicos, Laxmi Nagar", vpa: "sharmamedicos@ptyes" },
      status: "debited_not_credited",
      at: failedAt,
      reversal: { deadline: reversalDeadline({ kind: "p2m", at: failedAt }).toISOString() },
    }),
    txn({
      ...debit,
      id: DEMO_RECORDS.reversedTransfer,
      kind: "p2p",
      amount: 1500,
      counterparty: { name: "Aman Verma", vpa: "aman.verma@ptaxis" },
      status: "reversed",
      at: transferAt,
      reversal: {
        deadline: reversalDeadline({ kind: "p2p", at: transferAt }).toISOString(),
        reversedAt,
        rrn: rrnAt(reversedAt, "reversal-60388"),
      },
    }),
    txn({
      ...debit,
      id: "TXN-60279",
      kind: "p2m",
      amount: 1840,
      counterparty: { name: "BSES Rajdhani Power Ltd", vpa: "bsesrajdhani@ptyes" },
      at: billAt,
    }),
    txn({
      ...debit,
      id: "TXN-60233",
      kind: "p2m",
      amount: 8450,
      counterparty: { name: "Paytm Flights (IndiGo DEL-BLR)", vpa: "paytmtravel@paytm" },
      at: flightAt,
    }),
    txn({ ...debit, id: "TXN-60431", kind: "p2m", amount: 96, counterparty: { name: "Mother Dairy, Mayur Vihar", vpa: "motherdairy.mv@ptsbi" }, at: clock.at(0, 8, 15) }),
    txn({ ...debit, id: "TXN-60418", kind: "p2m", amount: 40, counterparty: { name: "Raju Tea Stall", vpa: "rajutea@ptaxis" }, at: clock.at(1, 17, 5) }),
    txn({ ...debit, id: "TXN-60405", kind: "p2m", amount: 349, counterparty: { name: "Jio Prepaid Recharge", vpa: "jiorecharge@paytm" }, at: clock.at(2, 11, 30) }),
    txn({ ...debit, id: "TXN-60397", kind: "p2m", amount: 612, counterparty: { name: "Blinkit", vpa: "blinkit@ptyes" }, at: clock.at(3, 20, 5) }),
    txn({ ...debit, id: "TXN-60372", kind: "p2p", amount: 500, counterparty: { name: "Rohan Mehta", vpa: "rohanmehta@pthdfc" }, at: clock.at(5, 22, 40) }),
    txn({
      customerId: id,
      id: "TXN-60361",
      direction: "credit",
      kind: "p2p",
      amount: 450,
      counterparty: { name: "Nikhil Arora", vpa: "nikhil.arora@ptsbi" },
      status: "success",
      at: clock.at(6, 23, 10),
    }),
    txn({ ...debit, id: "TXN-60344", kind: "p2m", amount: 500, counterparty: { name: "DMRC Metro Card Recharge", vpa: "dmrc@ptsbi" }, at: clock.at(7, 9, 10) }),
    txn({ ...debit, id: "TXN-60301", kind: "p2m", amount: 389, counterparty: { name: "Swiggy", vpa: "swiggy@ptaxis" }, at: clock.at(8, 20, 45) }),
  );

  const jioCashback: Reward = {
    id: "RWD-3051",
    customerId: id,
    txnId: "TXN-60405",
    offer: "₹15 cashback on Jio prepaid recharge",
    amount: 15,
    status: "credited",
    promisedBy: clock.at(1, 11, 30),
    creditedAt: clock.at(2, 11, 31),
    payoutId: "PO-K7M2QX",
  };
  const scratchCard: Reward = {
    id: "RWD-3012",
    customerId: id,
    txnId: "TXN-60372",
    offer: "₹10 scratch card on UPI transfer",
    amount: 10,
    status: "credited",
    promisedBy: clock.at(4, 22, 40),
    creditedAt: clock.at(5, 22, 41),
    payoutId: "PO-R4T8WN",
  };
  seed.rewards.push(
    {
      id: DEMO_RECORDS.billCashback,
      customerId: id,
      txnId: "TXN-60279",
      offer: "₹50 cashback on electricity bill payment via UPI",
      amount: 50,
      status: "pending",
      promisedBy: clock.at(6, 10, 20),
      failureNote: "Cashback engine timed out while crediting and never retried",
    },
    {
      id: DEMO_RECORDS.flightCashback,
      customerId: id,
      txnId: "TXN-60233",
      offer: "Flat ₹750 cashback on domestic flights (code FLYUPI750)",
      amount: 750,
      status: "pending",
      promisedBy: clock.at(7, 21, 10),
      failureNote: "Credit queued by the offers engine but never released",
    },
    jioCashback,
    scratchCard,
    {
      id: "RWD-2988",
      customerId: id,
      txnId: "TXN-60301",
      offer: "₹100 off on Swiggy orders above ₹499",
      amount: 100,
      status: "expired",
      promisedBy: clock.at(1, 23, 59),
      failureNote: "Order value ₹389 was below the ₹499 minimum",
    },
  );
  seed.payouts.push(
    cashbackPayout(jioCashback, "PO-K7M2QX", jioCashback.creditedAt ?? clock.at(2, 11, 31)),
    cashbackPayout(scratchCard, "PO-R4T8WN", scratchCard.creditedAt ?? clock.at(5, 22, 41)),
  );

  // The EMI falls on the 5th; the latest one taken is this month's if the 5th has passed, else last month's.
  const dueDay = 5;
  const latestDue = Number(clock.today.slice(8, 10)) >= dueDay ? 0 : 1;
  const emiMonths = [4, 3, 2, 1, 0].map((back) => back + latestDue);
  const deductions = emiMonths.map((back, index) => {
    const at = clock.onMonthDay(back, dueDay, 9, 5);
    return { id: `${DEMO_RECORDS.personalLoan}-D${index + 1}`, at, amount: 4680, rrn: rrnAt(at, `emi-${index}`) };
  });
  const repeatAt = clock.onMonthDay(latestDue, dueDay, 9, 47);
  deductions.push({ id: `${DEMO_RECORDS.personalLoan}-D6`, at: repeatAt, amount: 4680, rrn: rrnAt(repeatAt, "emi-repeat") });

  seed.loans.push({
    id: DEMO_RECORDS.personalLoan,
    customerId: id,
    lender: "Aditya Birla Capital",
    product: "personal",
    principal: 50_000,
    outstanding: 30_482,
    repayment: { mode: "emi", amount: 4680, dueDay },
    deductions,
    grievanceOfficer: { name: "Grievance Redressal Officer, Aditya Birla Finance", email: "grievance.finance@adityabirlacapital.com" },
  });

  seed.tickets.push({
    id: "TCK-19988",
    customerId: id,
    category: "other",
    subject: "Full KYC re-verification",
    status: "resolved",
    priority: "low",
    notes: ["Aadhaar-based re-KYC completed; full KYC restored."],
    createdAt: clock.at(122, 11, 0),
    updatedAt: clock.at(121, 16, 30),
  });
}

// ---------- Merchant demo: a Laxmi Nagar kirana store on Paytm for Business ----------

const PAYERS: [string, string][] = [
  ["Sunil Yadav", "sunilyadav@ptsbi"],
  ["Pooja Sharma", "pooja.s@ptaxis"],
  ["Mohit Bansal", "mohitbansal@pthdfc"],
  ["Neha Gupta", "nehag@ptyes"],
  ["Arjun Singh", "arjun.singh@ptsbi"],
  ["Kavita Rawat", "kavitarawat@ptaxis"],
  ["Deepak Chauhan", "deepakc@okhdfcbank"],
  ["Ritu Jain", "ritujain@ybl"],
  ["Vikas Tiwari", "vikas.t@pthdfc"],
  ["Shabnam Khan", "shabnamk@ptyes"],
  ["Harish Negi", "harishnegi@ptsbi"],
  ["Anjali Mishra", "anjalim@okaxis"],
];

const ANNOUNCED_AMOUNTS = [45, 120, 260, 30, 410, 85, 150, 60, 230, 95, 320, 40, 175, 110];
const SILENT_AMOUNTS = [120, 340, 85, 460, 210, 60, 395, 180, 450];

function seedMerchantDemo(seed: SeedData, clock: SeedClock): void {
  const id = DEMO_MERCHANT_ID;
  const { now } = clock;

  seed.customers.push({
    id,
    kind: "merchant",
    name: "Rakesh Kumar",
    phone: DEMO_PROFILES.merchant.placeholderPhone,
    email: "rakeshkiranastore@gmail.com",
    city: "Delhi",
    language: "hindi",
    since: "2019-06-11",
    kyc: "full",
    upiHandle: "rakeshkirana@ptaxis",
    bank: { bank: "SBI", last4: "3307", ifsc: "SBIN0011570", status: "active" },
    flags: [],
    business: {
      name: "Rakesh Kirana Store",
      mid: "RAKESH04318265907134",
      category: "Grocery & Kirana",
      address: "Shop No. 14, Main Vikas Marg, Laxmi Nagar, Delhi 110092",
    },
  });

  // The Soundbox drops off around 2 pm; when the demo runs earlier in the day, it went quiet two hours ago.
  const offlineAt = Math.min(atIst(clock.today, 14, 5).getTime(), now.getTime() - 2 * HOUR_MS);
  const silentFrom = offlineAt + 9 * MINUTE_MS;
  const silentTo = now.getTime() - 6 * MINUTE_MS;
  const credit = { customerId: id, direction: "credit" as const, kind: "p2m" as const, status: "success" as const };
  const soundboxId = DEMO_RECORDS.offlineSoundbox;

  ANNOUNCED_AMOUNTS.forEach((amount, index) => {
    const [payer, vpa] = PAYERS[index % PAYERS.length];
    seed.transactions.push(
      txn({
        ...credit,
        id: `TXN-${70101 + index}`,
        amount,
        counterparty: { name: payer, vpa },
        at: clock.clamp(offlineAt - (ANNOUNCED_AMOUNTS.length - index) * 21 * MINUTE_MS),
        deviceId: soundboxId,
        announced: true,
      }),
    );
  });
  SILENT_AMOUNTS.forEach((amount, index) => {
    const [payer, vpa] = PAYERS[(index + 5) % PAYERS.length];
    const at = silentFrom + ((silentTo - silentFrom) * index) / (SILENT_AMOUNTS.length - 1);
    seed.transactions.push(
      txn({
        ...credit,
        id: `TXN-${70101 + ANNOUNCED_AMOUNTS.length + index}`,
        amount,
        counterparty: { name: payer, vpa },
        at: clock.clamp(at),
        deviceId: soundboxId,
        announced: false,
      }),
    );
  });

  const swappedOn = clock.onMonthDay(2, 2, 11, 0);
  const soundbox: DeviceRecord = {
    id: soundboxId,
    customerId: id,
    model: "Paytm Soundbox 5.0",
    status: "offline",
    lastSeen: clock.clamp(offlineAt),
    health: { signal: "weak", battery: 64, firmware: "4.2.1", latestFirmware: "4.3.0", sim: "Airtel 4G", volume: 80 },
    rental: { monthly: 299, deposit: 499, startedAt: swappedOn, billingActive: true },
  };
  const cardSoundbox: DeviceRecord = {
    id: DEMO_RECORDS.returnedSoundbox,
    customerId: id,
    model: "Paytm Card Soundbox",
    status: "returned",
    lastSeen: clock.onMonthDay(2, 3, 10, 50),
    health: { signal: "none", battery: 0, firmware: "3.8.4", latestFirmware: "3.9.0", sim: "Jio 4G", volume: 0 },
    rental: {
      monthly: 599,
      deposit: 0,
      startedAt: clock.onMonthDay(14, 12, 12, 0),
      returnedAt: clock.onMonthDay(2, 3, 11, 30),
      pickupRef: "PKP-DL-482913",
      billingActive: true,
    },
  };
  seed.devices.push(soundbox, cardSoundbox);
  seed.rentalCharges.push(
    ...monthlyCharges(clock, cardSoundbox, [5, 4, 3, 2, 1, 0]),
    ...monthlyCharges(clock, soundbox, [2, 1, 0], swappedOn),
  );

  const history = [
    { daysAgo: 7, amount: 14_785, count: 49 },
    { daysAgo: 6, amount: 19_660, count: 66 },
    { daysAgo: 5, amount: 22_105, count: 74 },
    { daysAgo: 4, amount: 17_430, count: 60 },
    { daysAgo: 3, amount: 21_340, count: 71 },
    { daysAgo: 2, amount: 16_920, count: 58 },
  ];
  const loanDeductions: Loan["deductions"] = [];
  history.forEach(({ daysAgo, amount, count }, index) => {
    const settledAt = clock.at(daysAgo - 1, 8, 40);
    const settlementId = `STL-${90724 + index}`;
    seed.settlements.push({
      id: settlementId,
      customerId: id,
      forDate: shiftDateKey(clock.today, -daysAgo),
      amount,
      txnCount: count,
      status: "settled",
      bankLast4: "3307",
      utr: rrnAt(settledAt, settlementId),
      settledAt,
      retries: 0,
    });
    const deductedAt = clock.at(daysAgo - 1, 8, 41);
    loanDeductions.push({ id: `${DEMO_RECORDS.merchantLoan}-D${index + 1}`, at: deductedAt, amount: 620, rrn: rrnAt(deductedAt, `ml-${index}`) });
  });
  seed.settlements.push({
    id: DEMO_RECORDS.failedSettlement,
    customerId: id,
    forDate: shiftDateKey(clock.today, -1),
    amount: 18_450,
    txnCount: 62,
    status: "failed",
    bankLast4: "3307",
    failure: { code: "BANK_TIMEOUT", note: "SBI did not confirm the IMPS credit in time; the money never left Paytm" },
    retries: 0,
  });

  seed.loans.push({
    id: DEMO_RECORDS.merchantLoan,
    customerId: id,
    lender: "Piramal Finance",
    product: "merchant",
    principal: 150_000,
    outstanding: 97_560,
    repayment: { mode: "daily", amount: 620 },
    deductions: loanDeductions,
    grievanceOfficer: { name: "Grievance Redressal Officer, Piramal Finance", email: "grievance.officer@piramal.com" },
  });
}

// ---------- Back office: the rest of the care queue ----------

function seedBackOffice(seed: SeedData, clock: SeedClock): void {
  seed.customers.push(
    {
      id: "CUST-1002",
      kind: "consumer",
      name: "Priya Malhotra",
      phone: "+919810234567",
      email: "priya.malhotra@outlook.com",
      city: "New Delhi",
      language: "english",
      since: "2018-08-02",
      kyc: "full",
      upiHandle: "priya.malhotra@pthdfc",
      bank: { bank: "HDFC Bank", last4: "6612", ifsc: "HDFC0001234", status: "active" },
      flags: [],
    },
    {
      id: "CUST-1003",
      kind: "consumer",
      name: "Imran Qureshi",
      phone: "+919871045623",
      email: "imran.q91@gmail.com",
      city: "New Delhi",
      language: "hinglish",
      since: "2024-11-20",
      kyc: "minimum",
      upiHandle: "imranq@ptyes",
      bank: { bank: "YES Bank", last4: "2290", ifsc: "YESB0000417", status: "active" },
      flags: ["cashback_abuse_suspected"],
    },
    {
      id: "MER-2002",
      kind: "merchant",
      name: "Sunita Arora",
      phone: "+919899012784",
      email: "arorasweets.rg@gmail.com",
      city: "Delhi",
      language: "hinglish",
      since: "2020-02-17",
      kyc: "full",
      upiHandle: "arorasweets@pthdfc",
      bank: { bank: "HDFC Bank", last4: "7710", ifsc: "HDFC0000589", status: "closed" },
      flags: [],
      business: {
        name: "Arora Sweets & Namkeen",
        mid: "ARORAS71820465310297",
        category: "Sweets & Bakery",
        address: "J-12/4, Rajouri Garden Main Market, Delhi 110027",
      },
    },
    {
      id: "MER-2003",
      kind: "merchant",
      name: "Mohd. Salim",
      phone: "+919711458302",
      email: "salimmobilepoint@gmail.com",
      city: "Delhi",
      language: "hindi",
      since: "2021-09-05",
      kyc: "full",
      upiHandle: "salimmobile@ptsbi",
      bank: { bank: "Axis Bank", last4: "5521", ifsc: "UTIB0000049", status: "active" },
      flags: ["collection_spike"],
      business: {
        name: "Salim Mobile Point",
        mid: "SALIMM50291837465021",
        category: "Mobile Phones & Repair",
        address: "Shop 7, Bhagirath Palace, Chandni Chowk, Delhi 110006",
      },
    },
  );

  const stuckAt = clock.at(7, 18, 30);
  const disputeRaisedAt = clock.at(6, 10, 15);
  seed.transactions.push(
    txn({
      id: "TXN-51207",
      customerId: "CUST-1002",
      direction: "debit",
      kind: "p2m",
      amount: 1200,
      counterparty: { name: "Reliance Smart, Dwarka", vpa: "reliancesmart.dwk@pthdfc" },
      status: "debited_not_credited",
      at: stuckAt,
      reversal: { deadline: reversalDeadline({ kind: "p2m", at: stuckAt }).toISOString() },
      disputeId: "UDIR-5520918734",
    }),
    txn({
      id: "TXN-51242",
      customerId: "CUST-1002",
      direction: "debit",
      kind: "p2p",
      amount: 250,
      counterparty: { name: "Kunal Malhotra", vpa: "kunalm@pthdfc" },
      status: "success",
      at: clock.at(2, 13, 0),
    }),
    txn({
      id: "TXN-52118",
      customerId: "CUST-1003",
      direction: "debit",
      kind: "p2m",
      amount: 2999,
      counterparty: { name: "Croma, Rajouri Garden", vpa: "croma.rg@ptyes" },
      status: "success",
      at: clock.at(10, 16, 40),
    }),
    txn({
      id: "TXN-52131",
      customerId: "CUST-1003",
      direction: "debit",
      kind: "p2m",
      amount: 150,
      counterparty: { name: "Haldiram's, Connaught Place", vpa: "haldirams.cp@ptaxis" },
      status: "success",
      at: clock.at(3, 14, 5),
    }),
  );
  seed.disputes.push({
    id: "UDIR-5520918734",
    customerId: "CUST-1002",
    txnId: "TXN-51207",
    channel: "UDIR",
    reason: "Debited but not credited to merchant",
    status: "in_review",
    raisedAt: disputeRaisedAt,
    expectedBy: udirExpectedBy(new Date(disputeRaisedAt)).toISOString(),
  });
  seed.rewards.push({
    id: "RWD-3122",
    customerId: "CUST-1003",
    txnId: "TXN-52118",
    offer: "₹300 cashback on electronics above ₹2,500",
    amount: 300,
    status: "pending",
    promisedBy: clock.at(5, 16, 40),
    failureNote: "Held by the offers risk check",
  });

  const sweetsBox: DeviceRecord = {
    id: "SB4-23097715",
    customerId: "MER-2002",
    model: "Paytm Soundbox 4.0",
    status: "online",
    lastSeen: clock.at(0, 12, 40),
    health: { signal: "good", battery: 91, firmware: "4.3.0", latestFirmware: "4.3.0", sim: "Vi 4G", volume: 70 },
    rental: { monthly: 299, deposit: 499, startedAt: clock.onMonthDay(9, 14, 12, 0), billingActive: true },
  };
  const repairBox: DeviceRecord = {
    id: "SB3-22114409",
    customerId: "MER-2003",
    model: "Paytm Soundbox 3.0",
    status: "offline",
    lastSeen: clock.at(2, 18, 12),
    health: { signal: "good", battery: 0, firmware: "3.9.0", latestFirmware: "3.9.0", sim: "Jio 4G", volume: 60 },
    rental: { monthly: 249, deposit: 499, startedAt: clock.onMonthDay(20, 9, 12, 0), billingActive: true },
    fault: "Power board failure; the device does not boot",
    lastRestart: { at: clock.at(1, 16, 20), ok: false },
  };
  seed.devices.push(sweetsBox, repairBox);
  seed.rentalCharges.push(...monthlyCharges(clock, sweetsBox, [1, 0]), ...monthlyCharges(clock, repairBox, [1, 0]));

  seed.settlements.push(
    {
      id: "STL-88409",
      customerId: "MER-2002",
      forDate: shiftDateKey(clock.today, -3),
      amount: 11_240,
      txnCount: 34,
      status: "settled",
      bankLast4: "7710",
      utr: rrnAt(clock.at(2, 8, 35), "STL-88409"),
      settledAt: clock.at(2, 8, 35),
      retries: 0,
    },
    {
      id: "STL-88412",
      customerId: "MER-2002",
      forDate: shiftDateKey(clock.today, -2),
      amount: 9_870,
      txnCount: 29,
      status: "failed",
      bankLast4: "7710",
      failure: { code: "ACCOUNT_CLOSED", note: "HDFC Bank returned the credit: account closed" },
      retries: 1,
    },
    {
      id: "STL-88530",
      customerId: "MER-2003",
      forDate: shiftDateKey(clock.today, -2),
      amount: 7_480,
      txnCount: 21,
      status: "settled",
      bankLast4: "5521",
      utr: rrnAt(clock.at(1, 8, 45), "STL-88530"),
      settledAt: clock.at(1, 8, 45),
      retries: 0,
    },
    {
      id: "STL-88533",
      customerId: "MER-2003",
      forDate: shiftDateKey(clock.today, -1),
      amount: 46_200,
      txnCount: 38,
      status: "on_hold",
      bankLast4: "5521",
      failure: { code: "RISK_HOLD", note: "Collections six times the usual daily volume; held for risk review" },
      retries: 0,
    },
  );

  seed.tickets.push(
    {
      id: "TCK-20007",
      customerId: "MER-2002",
      category: "settlement",
      relatedId: "STL-88412",
      subject: "Settlement failed: bank account closed",
      status: "open",
      priority: "normal",
      notes: ["HDFC Bank returned the settlement: account closed.", "Secure bank-update link sent in the app; waiting for the merchant."],
      createdAt: clock.at(1, 9, 10),
      updatedAt: clock.at(1, 9, 25),
    },
    {
      id: "TCK-20012",
      customerId: "CUST-1002",
      category: "upi",
      relatedId: "TXN-51207",
      subject: "Failed UPI payment to Reliance Smart",
      status: "open",
      priority: "normal",
      notes: ["UDIR dispute UDIR-5520918734 raised; HDFC Bank past the T+5 deadline, compensation accruing."],
      createdAt: disputeRaisedAt,
      updatedAt: clock.at(1, 15, 0),
    },
    {
      id: "TCK-20015",
      customerId: "MER-2003",
      category: "device",
      relatedId: "SB3-22114409",
      subject: "Soundbox not booting",
      status: "open",
      priority: "normal",
      notes: ["Remote restart failed; the device did not come back online."],
      createdAt: clock.at(1, 16, 25),
      updatedAt: clock.at(1, 16, 25),
    },
  );
}

export function createSeed(now: Date = new Date()): SeedData {
  const seed: SeedData = {
    customers: [],
    transactions: [],
    disputes: [],
    settlements: [],
    devices: [],
    rentalCharges: [],
    rewards: [],
    loans: [],
    payouts: [],
    tickets: [],
  };
  const clock = seedClock(now);
  // The demo profiles come first, so a number shared with a back-office record still resolves to the demo.
  seedConsumerDemo(seed, clock);
  seedMerchantDemo(seed, clock);
  seedBackOffice(seed, clock);
  return seed;
}
