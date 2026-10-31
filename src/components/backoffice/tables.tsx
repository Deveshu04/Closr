import {
  ArrowUpRight,
  Battery,
  BatteryLow,
  BatteryMedium,
  BatteryFull,
  FileText,
  Signal,
  SignalLow,
  SignalZero,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  ConsoleState,
  Customer,
  Device,
  Dispute,
  FollowUp,
  Loan,
  Offer,
  Payout,
  RentalCharge,
  Reward,
  Settlement,
  Ticket,
  UpiTransaction,
} from "@/lib/types";
import { type Pulses, isPulsing } from "../hooks/useActivity";
import {
  billingMonth,
  humanize,
  inr,
  lastFour,
  shortDate,
  shortDateTime,
  timeOfDay,
  weekdayDate,
} from "../lib/format";
import { PAYOUT_KIND, chargedAfterReturn, firmwareBehind, repeatedDeductions } from "../lib/records";
import { TABS, type TabId } from "../lib/systems";
import { type Column, RecordTable, type RecordTableProps } from "../RecordTable";
import { StatusPill } from "../StatusPill";

export interface TabTable {
  count: number;
  hot: boolean;
  /** Shown above the table: a fact about the caller's records worth seeing before the rows. */
  notice?: ReactNode;
  render: () => ReactNode;
}

interface Context {
  callerId: string | undefined;
  callerLabel: string;
  pulses: Pulses;
  now: number;
}

type Spec<T> = Omit<RecordTableProps<T>, "callerLabel" | "pulses" | "now" | "isCaller" | "emptyIcon">;

function table<T extends { customerId: string }>(tab: TabId, spec: Spec<T>, ctx: Context, notice?: ReactNode): TabTable {
  const isCaller = (row: T) => row.customerId === ctx.callerId;
  return {
    count: spec.rows.length,
    hot: spec.rows.some((r) => isPulsing(ctx.pulses, spec.matchIds(r), ctx.now) !== undefined),
    notice,
    render: () => (
      <RecordTable
        {...spec}
        isCaller={isCaller}
        callerLabel={ctx.callerLabel}
        pulses={ctx.pulses}
        now={ctx.now}
        emptyIcon={TABS[tab].icon}
      />
    ),
  };
}

function newestFirst<T>(rows: T[], at: (row: T) => string | undefined): T[] {
  const time = (row: T) => {
    const t = Date.parse(at(row) ?? "");
    return Number.isFinite(t) ? t : 0;
  };
  return [...rows].sort((a, b) => time(b) - time(a));
}

const dash = <span className="text-faint">—</span>;

const DISPUTE_KIND: Record<Dispute["kind"], string> = {
  debited_not_credited: "Debited, not credited",
  credit_not_received: "Credit not received",
};

function IdCell({ id, sub }: { id: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <p className="figures whitespace-nowrap font-semibold text-navy">{id}</p>
      {sub && <p className="figures mt-0.5 whitespace-nowrap text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Primary({ title, sub, width = "max-w-[15rem]" }: { title: ReactNode; sub?: ReactNode; width?: string }) {
  return (
    <div className={`min-w-0 ${width}`}>
      <p className="truncate font-medium text-ink">{title}</p>
      {sub && <p className="figures mt-0.5 truncate text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** A long reference shown by its last four, with the full value on hover. */
function Masked({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return dash;
  return (
    <span title={`${label} ${value}`} className="figures cursor-help whitespace-nowrap text-ink underline decoration-rule decoration-dotted underline-offset-4">
      {lastFour(value)}
    </span>
  );
}

function Money({ amount, sign }: { amount: number; sign?: "+" | "−" }) {
  return (
    <span className={`figures whitespace-nowrap font-semibold ${sign === "+" ? "text-leaf" : "text-ink"}`}>
      {sign && <span className="mr-0.5 font-normal">{sign}</span>}
      {inr(amount)}
    </span>
  );
}

/** An amount with the reference it moved under, e.g. its RRN. */
function AmountRef({
  amount,
  sign,
  refLabel,
  refValue,
}: {
  amount: number;
  sign?: "+" | "−";
  refLabel: string;
  refValue?: string;
}) {
  return (
    <div>
      <Money amount={amount} sign={sign} />
      {refValue && (
        <p className="mt-0.5 whitespace-nowrap text-xs font-normal text-muted">
          {refLabel} <Masked label={refLabel} value={refValue} />
        </p>
      )}
    </div>
  );
}

function Flag({ tone, children }: { tone: "brick" | "amber" | "leaf" | "muted"; children: ReactNode }) {
  const color = { brick: "text-brick", amber: "text-amber", leaf: "text-leaf", muted: "text-muted" }[tone];
  return <p className={`figures mt-1 whitespace-nowrap text-xs font-medium ${color}`}>{children}</p>;
}

function SignalCell({ signal }: { signal: Device["health"]["signal"] }) {
  const meta = {
    good: { icon: Signal, label: "Good", className: "text-leaf" },
    weak: { icon: SignalLow, label: "Weak", className: "text-amber" },
    none: { icon: SignalZero, label: "No signal", className: "text-brick" },
  }[signal] ?? { icon: SignalZero, label: humanize(String(signal)), className: "text-muted" };
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium ${meta.className}`}>
      <Icon aria-hidden size={15} strokeWidth={2.25} />
      {meta.label}
    </span>
  );
}

function BatteryCell({ level }: { level: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(level)));
  const Icon = pct >= 80 ? BatteryFull : pct >= 40 ? BatteryMedium : pct >= 15 ? BatteryLow : Battery;
  const tone = pct < 15 ? "text-brick" : pct < 40 ? "text-amber" : "text-ink";
  return (
    <span className={`figures inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium ${tone}`}>
      <Icon aria-hidden size={16} strokeWidth={2} />
      {pct}%
    </span>
  );
}

function Announced({ value }: { value: boolean | undefined }) {
  if (value === undefined) return dash;
  return value ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted">
      <Volume2 aria-hidden size={14} />
      Announced
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-wash py-0.5 pl-2 pr-2.5 text-[12.5px] font-semibold text-amber">
      <VolumeX aria-hidden size={13} strokeWidth={2.25} />
      Not announced
    </span>
  );
}

export function buildTables(state: ConsoleState, ctx: Context): Record<TabId, TabTable> {
  const customers = new Map<string, Customer>(state.customers.map((c) => [c.id, c]));
  const txns = new Map<string, UpiTransaction>(state.transactions.map((t) => [t.id, t]));
  const devices = new Map<string, Device>(state.devices.map((d) => [d.id, d]));
  const nameOf = (id: string) => {
    const c = customers.get(id);
    return c ? (c.business?.name ?? c.name) : id;
  };
  const customerColumn = <T extends { customerId: string }>(): Column<T> => ({
    header: "Customer",
    minor: true,
    cell: (row) => <span className="whitespace-nowrap text-muted">{nameOf(row.customerId)}</span>,
  });

  const isMerchantTxn = (t: UpiTransaction) => {
    const kind = customers.get(t.customerId)?.kind;
    return kind ? kind === "merchant" : t.direction === "credit" && Boolean(t.deviceId);
  };
  const allTxns = newestFirst(state.transactions, (t) => t.at);
  const consumerTxns = allTxns.filter((t) => !isMerchantTxn(t));
  const collections = allTxns.filter(isMerchantTxn);
  const txnIds = (t: UpiTransaction) => [t.id, t.rrn];

  const upiColumns: Column<UpiTransaction>[] = [
    {
      header: "Payment",
      cell: (t) => (
        <Primary
          title={t.counterparty.name}
          sub={`${t.kind.toUpperCase()} · ${shortDateTime(t.at)}`}
          width="max-w-[10rem]"
        />
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (t) => (
        <AmountRef amount={t.amount} sign={t.direction === "credit" ? "+" : "−"} refLabel="RRN" refValue={t.rrn} />
      ),
    },
    {
      header: "Status",
      cell: (t) => (
        <div>
          {t.status === "flagged" && t.flag ? (
            <span
              title={`${t.flag.reason} · flagged ${shortDateTime(t.flag.flaggedAt)}, was ${humanize(t.flag.previousStatus).toLowerCase()}`}
              className="cursor-help"
            >
              <StatusPill value={t.status} />
            </span>
          ) : (
            <StatusPill value={t.status} />
          )}
          {t.disputeId && <Flag tone="muted">Dispute {lastFour(t.disputeId)}</Flag>}
        </div>
      ),
    },
    {
      header: "Reversal",
      cell: (t) =>
        t.reversal ? (
          t.reversal.reversedAt ? (
            <div className="whitespace-nowrap">
              <p className="font-medium text-leaf">Reversed {shortDate(t.reversal.reversedAt)}</p>
              {t.reversal.rrn && (
                <p className="text-xs text-muted">
                  Ref <Masked label="Reversal RRN" value={t.reversal.rrn} />
                </p>
              )}
            </div>
          ) : (
            <div className="whitespace-nowrap">
              <p className="font-medium text-ink">By {weekdayDate(t.reversal.deadline)}</p>
              <p className="text-xs text-muted">RBI T+5 deadline</p>
            </div>
          )
        ) : (
          dash
        ),
    },
    customerColumn<UpiTransaction>(),
  ];

  const collectionColumns: Column<UpiTransaction>[] = [
    {
      header: "Received from",
      cell: (t) => <Primary title={t.counterparty.name} sub={`${timeOfDay(t.at)} · ${shortDate(t.at)}`} />,
    },
    {
      header: "Amount",
      align: "right",
      cell: (t) => <AmountRef amount={t.amount} sign="+" refLabel="RRN" refValue={t.rrn} />,
    },
    { header: "Soundbox", cell: (t) => <Announced value={t.announced} /> },
    { header: "Status", cell: (t) => <StatusPill value={t.status} /> },
    customerColumn<UpiTransaction>(),
  ];

  const unannounced = collections.filter((t) => t.customerId === ctx.callerId && t.status === "success" && t.announced === false);
  const unannouncedTotal = unannounced.reduce((sum, t) => sum + t.amount, 0);
  const collectionsNotice =
    unannounced.length > 0 ? (
      <p className="flex items-start gap-2.5 text-[13.5px] leading-snug text-ink">
        <VolumeX aria-hidden size={16} className="mt-0.5 shrink-0 text-amber" />
        <span>
          <span className="figures font-semibold">
            {unannounced.length} {unannounced.length === 1 ? "payment" : "payments"} · {inr(unannouncedTotal)}
          </span>{" "}
          received but not announced on the Soundbox. The money is safe; only the announcement was missed.
        </span>
      </p>
    ) : undefined;

  const disputeColumns: Column<Dispute>[] = [
    { header: "Dispute", cell: (d) => <IdCell id={d.id} sub={`Raised ${shortDate(d.raisedAt)}`} /> },
    {
      header: "Payment",
      cell: (d) => {
        const t = txns.get(d.txnId);
        if (!t) return <span className="figures text-muted">{d.txnId}</span>;
        return (
          <div className="max-w-[13rem]">
            <p className="truncate font-medium text-ink">
              <Money amount={t.amount} /> <span className="font-normal text-muted">to</span> {t.counterparty.name}
            </p>
            <p className="text-xs text-muted">
              RRN <Masked label="RRN" value={t.rrn} />
            </p>
          </div>
        );
      },
    },
    {
      header: "Kind · reason",
      cell: (d) => (
        <div className="max-w-[14rem]">
          <p className="whitespace-nowrap text-[13px] font-semibold text-ink">{DISPUTE_KIND[d.kind] ?? "UPI dispute"}</p>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{d.reason}</p>
        </div>
      ),
    },
    { header: "Status", cell: (d) => <StatusPill value={d.status} /> },
    {
      header: "Deadlines",
      cell: (d) => {
        const deadline = txns.get(d.txnId)?.reversal?.deadline;
        return (
          <div className="figures whitespace-nowrap">
            {deadline && <p className="font-medium text-ink">Reverse by {weekdayDate(deadline)}</p>}
            <p className={deadline ? "text-xs text-muted" : "font-medium text-ink"}>Closes by {weekdayDate(d.expectedBy)}</p>
          </div>
        );
      },
    },
  ];

  const rewardColumns: Column<Reward>[] = [
    { header: "Cashback", cell: (r) => <Primary title={r.offer} sub={r.id} width="max-w-[12rem]" /> },
    { header: "Amount", align: "right", cell: (r) => <Money amount={r.amount} /> },
    {
      header: "Status",
      cell: (r) => (
        <div>
          <StatusPill value={r.status} />
          {r.failureNote && <p className="mt-1 line-clamp-2 max-w-[12rem] text-xs text-muted">{r.failureNote}</p>}
        </div>
      ),
    },
    {
      header: "Promised by",
      cell: (r) => {
        const overdue = r.status !== "credited" && Date.parse(r.promisedBy) < ctx.now;
        return (
          <div className="whitespace-nowrap">
            <p className="figures">{shortDate(r.promisedBy)}</p>
            {r.creditedAt ? (
              <Flag tone="leaf">Credited {shortDate(r.creditedAt)}</Flag>
            ) : (
              overdue && <Flag tone="brick">Overdue</Flag>
            )}
          </div>
        );
      },
    },
    {
      header: "Payout",
      minor: true,
      cell: (r) => (r.payoutId ? <span className="figures whitespace-nowrap">{r.payoutId}</span> : dash),
    },
  ];

  const loanColumns: Column<Loan>[] = [
    {
      header: "Loan",
      cell: (l) => (
        <Primary
          title={l.lender}
          sub={`${l.repayment.mode === "emi" ? "EMI" : "Daily"} ${inr(l.repayment.amount)}${
            l.repayment.dueDay ? ` on day ${l.repayment.dueDay}` : ""
          } · ${l.id}`}
        />
      ),
    },
    {
      header: "Outstanding",
      align: "right",
      cell: (l) => (
        <div>
          <Money amount={l.outstanding} />
          <p className="text-xs text-muted">of {inr(l.principal)}</p>
        </div>
      ),
    },
    {
      header: "Recent deductions",
      cell: (l) => {
        const repeated = repeatedDeductions(l);
        const recent = newestFirst(l.deductions, (d) => d.at).slice(0, 3);
        if (recent.length === 0) return dash;
        return (
          <ul className="space-y-0.5">
            {recent.map((d) => (
              <li
                key={d.id}
                className={`figures flex items-baseline gap-2 whitespace-nowrap text-[13px] ${repeated.has(d.id) ? "font-semibold text-brick" : "text-ink"}`}
              >
                <span>{shortDate(d.at)}</span>
                <span>{inr(d.amount)}</span>
                <Masked label="RRN" value={d.rrn} />
              </li>
            ))}
            {repeated.size > 0 && <Flag tone="brick">Deducted twice in one month</Flag>}
          </ul>
        );
      },
    },
    {
      header: "Grievance officer",
      minor: true,
      cell: (l) => (
        <div className="max-w-[12rem]">
          <p className="truncate text-[13px]">{l.grievanceOfficer.name}</p>
          <p className="truncate text-xs text-muted">{l.grievanceOfficer.email}</p>
        </div>
      ),
    },
  ];

  const settlementColumns: Column<Settlement>[] = [
    {
      header: "Settlement",
      cell: (s) => (
        <IdCell id={s.id} sub={`For ${shortDate(s.forDate)} · ${s.txnCount} ${s.txnCount === 1 ? "payment" : "payments"}`} />
      ),
    },
    { header: "Amount", align: "right", cell: (s) => <Money amount={s.amount} /> },
    {
      header: "Status",
      cell: (s) => (
        <div className="max-w-[14rem]">
          <StatusPill value={s.status} />
          {s.failure && (
            <p title={s.failure.note} className="mt-1 line-clamp-2 text-xs text-muted">
              <span className="font-semibold text-brick">{humanize(s.failure.code)}</span> · {s.failure.note}
            </p>
          )}
          {s.retries > 0 && <Flag tone="muted">Retried {s.retries}×</Flag>}
          {s.settledAt && <Flag tone="muted">Settled {shortDateTime(s.settledAt)}</Flag>}
        </div>
      ),
    },
    {
      header: "Bank · UTR",
      cell: (s) => (
        <div className="whitespace-nowrap">
          <p className="figures">A/c {lastFour(s.bankLast4)}</p>
          {s.utr && (
            <p className="text-xs text-muted">
              UTR <Masked label="UTR" value={s.utr} />
            </p>
          )}
        </div>
      ),
    },
    customerColumn<Settlement>(),
  ];

  const deviceColumns: Column<Device>[] = [
    { header: "Soundbox", cell: (d) => <Primary title={d.model} sub={`S/N ${d.id}`} /> },
    {
      header: "Status",
      cell: (d) => (
        <div>
          <StatusPill value={d.status} />
          {d.status === "offline" && <Flag tone="muted">Last seen {timeOfDay(d.lastSeen)}</Flag>}
          {d.status === "returned" && d.rental.returnedAt && <Flag tone="muted">On {shortDate(d.rental.returnedAt)}</Flag>}
        </div>
      ),
    },
    {
      header: "Health",
      cell: (d) =>
        d.status === "returned" ? (
          dash
        ) : (
          <div className="flex flex-col gap-1">
            <SignalCell signal={d.health.signal} />
            <BatteryCell level={d.health.battery} />
          </div>
        ),
    },
    {
      header: "Firmware",
      cell: (d) => (
        <div className="whitespace-nowrap">
          <p className="figures text-[13px]">{d.health.firmware}</p>
          {firmwareBehind(d) ? (
            <Flag tone="amber">{d.health.latestFirmware} available</Flag>
          ) : (
            <Flag tone="leaf">Latest</Flag>
          )}
        </div>
      ),
    },
    customerColumn<Device>(),
  ];

  const rentalColumns: Column<RentalCharge>[] = [
    { header: "Charge", cell: (c) => <IdCell id={billingMonth(c.period)} sub={`Charged ${shortDate(c.chargedAt)}`} /> },
    {
      header: "Device",
      cell: (c) => {
        const device = devices.get(c.deviceId);
        return (
          <div className="whitespace-nowrap">
            <p className="text-[13px] text-ink">{device?.model ?? c.deviceId}</p>
            {device?.rental.returnedAt ? (
              <p className="figures text-xs text-muted">Returned {shortDate(device.rental.returnedAt)}</p>
            ) : (
              <p className="figures text-xs text-muted">S/N {lastFour(c.deviceId)}</p>
            )}
          </div>
        );
      },
    },
    { header: "Amount", align: "right", cell: (c) => <Money amount={c.amount} /> },
    {
      header: "Status",
      cell: (c) => (
        <div>
          <StatusPill value={c.status} />
          {chargedAfterReturn(c, devices.get(c.deviceId)) && <Flag tone="brick">Charged after return</Flag>}
        </div>
      ),
    },
    { header: "Payout", minor: true, cell: (c) => (c.payoutId ? <span className="figures">{c.payoutId}</span> : dash) },
  ];

  const payoutColumns: Column<Payout>[] = [
    { header: "Payout", cell: (p) => <IdCell id={p.id} sub={shortDateTime(p.createdAt)} /> },
    { header: "For", cell: (p) => <Primary title={PAYOUT_KIND[p.kind] ?? humanize(p.kind)} sub={p.subjectId} /> },
    {
      header: "Amount",
      align: "right",
      cell: (p) => <AmountRef amount={p.amount} refLabel="RRN" refValue={p.rrn} />,
    },
    {
      header: "Status",
      cell: (p) => (
        <div>
          <StatusPill value={p.status} />
          {p.expectedBy && p.status === "processed" && <Flag tone="muted">Lands by {shortDate(p.expectedBy)}</Flag>}
        </div>
      ),
    },
    {
      header: "Idempotency key",
      minor: true,
      cell: (p) => (
        <span title={p.idempotencyKey} className="block max-w-[9rem] truncate font-mono text-[12px] text-muted">
          {p.idempotencyKey}
        </span>
      ),
    },
  ];

  const followUpColumns: Column<FollowUp>[] = [
    {
      header: "Due",
      cell: (f) => (
        <IdCell id={weekdayDate(f.dueAt)} sub={f.doneAt ? `Checked ${shortDateTime(f.doneAt)}` : humanize(f.kind)} />
      ),
    },
    {
      header: "Checking",
      cell: (f) => (
        <div className="max-w-[15rem]">
          <p className="line-clamp-2 text-[13px] text-ink">{f.note}</p>
          <p className="figures mt-0.5 whitespace-nowrap text-xs text-muted">Dispute {lastFour(f.disputeId)}</p>
        </div>
      ),
    },
    { header: "Status", cell: (f) => <StatusPill value={f.status} /> },
    {
      header: "Outcome",
      cell: (f) =>
        f.outcome ? <p className="line-clamp-3 max-w-[14rem] text-[13px] font-medium text-leaf">{f.outcome}</p> : dash,
    },
  ];

  const offerColumns: Column<Offer>[] = [
    {
      header: "Offer",
      cell: (o) => (
        <Primary title={o.product} sub={o.sentAt ? `Sent ${shortDateTime(o.sentAt)}` : o.id} width="max-w-[11rem]" />
      ),
    },
    {
      header: "Pitch · why it fits",
      cell: (o) => (
        <div className="max-w-[16rem]">
          <p className="line-clamp-2 text-[13px] text-ink">{o.pitch}</p>
          <p title={o.why} className="mt-0.5 line-clamp-2 text-xs text-muted">
            {o.why}
          </p>
        </div>
      ),
    },
    {
      header: "Status",
      cell: (o) => (
        <div className="flex flex-col items-start gap-1">
          <StatusPill value={o.status} />
          {o.regulated && (
            <span
              title="Lending product: the Key Fact Statement goes with the offer and consent is taken only in the app"
              className="inline-flex cursor-help items-center gap-1 whitespace-nowrap rounded-full bg-paper px-2 py-0.5 text-[12px] font-semibold text-navy ring-1 ring-inset ring-rule"
            >
              <FileText aria-hidden size={12} strokeWidth={2.25} />
              KFS attached
            </span>
          )}
        </div>
      ),
    },
    customerColumn<Offer>(),
  ];

  const ticketColumns: Column<Ticket>[] = [
    { header: "Ticket", cell: (t) => <IdCell id={t.id} sub={humanize(t.category)} /> },
    {
      header: "Subject",
      cell: (t) => {
        const note = t.notes?.at(-1);
        return (
          <div className="max-w-[14rem]">
            <p className="font-medium text-ink">{t.subject}</p>
            {note && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{note}</p>}
          </div>
        );
      },
    },
    {
      header: "Routed to",
      cell: (t) =>
        t.routedTo ? (
          <span className="inline-flex max-w-[11rem] items-start gap-1 text-[13px] font-medium text-navy">
            <ArrowUpRight aria-hidden size={14} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{t.routedTo}</span>
          </span>
        ) : (
          <span className="whitespace-nowrap text-[13px] text-muted">Paytm care</span>
        ),
    },
    {
      header: "Status",
      cell: (t) => (
        <div>
          <StatusPill value={t.status} />
          {t.priority === "high" && <Flag tone="brick">High priority</Flag>}
        </div>
      ),
    },
    {
      header: "Updated",
      minor: true,
      cell: (t) => <span className="figures whitespace-nowrap">{shortDateTime(t.updatedAt ?? t.createdAt)}</span>,
    },
  ];

  return {
    upi: table(
      "upi",
      {
        rows: consumerTxns,
        columns: upiColumns,
        rowKey: (t) => t.id,
        matchIds: txnIds,
        empty: "No UPI payments on record.",
        minWidth: "30rem",
      },
      ctx,
    ),
    collections: table(
      "collections",
      {
        rows: collections,
        columns: collectionColumns,
        rowKey: (t) => t.id,
        matchIds: txnIds,
        empty: "No payments received yet today.",
        minWidth: "30rem",
      },
      ctx,
      collectionsNotice,
    ),
    disputes: table(
      "disputes",
      {
        rows: newestFirst(state.disputes, (d) => d.raisedAt),
        columns: disputeColumns,
        rowKey: (d) => d.id,
        matchIds: (d) => [d.id],
        empty: "No disputes raised. When Closr raises a UDIR dispute, it lands here.",
        minWidth: "30rem",
      },
      ctx,
    ),
    followups: table(
      "followups",
      {
        rows: newestFirst(state.followUps, (f) => f.dueAt),
        columns: followUpColumns,
        rowKey: (f) => f.id,
        matchIds: (f) => [f.id],
        empty: "No follow-ups. When Closr raises a dispute, it schedules a check-back so the case closes only once the money lands.",
        minWidth: "30rem",
      },
      ctx,
    ),
    rewards: table(
      "rewards",
      {
        rows: newestFirst(state.rewards, (r) => r.promisedBy),
        columns: rewardColumns,
        rowKey: (r) => r.id,
        matchIds: (r) => [r.id],
        empty: "No cashback on record.",
        minWidth: "30rem",
      },
      ctx,
    ),
    loans: table(
      "loans",
      {
        rows: state.loans,
        columns: loanColumns,
        rowKey: (l) => l.id,
        matchIds: (l) => [l.id, ...l.deductions.map((d) => d.id)],
        empty: "No loans on record.",
        minWidth: "30rem",
      },
      ctx,
    ),
    settlements: table(
      "settlements",
      {
        rows: newestFirst(state.settlements, (s) => s.forDate),
        columns: settlementColumns,
        rowKey: (s) => s.id,
        matchIds: (s) => (s.utr ? [s.id, s.utr] : [s.id]),
        empty: "No settlements yet.",
        minWidth: "30rem",
      },
      ctx,
    ),
    devices: table(
      "devices",
      {
        rows: state.devices,
        columns: deviceColumns,
        rowKey: (d) => d.id,
        matchIds: (d) => [d.id],
        empty: "No Soundbox devices on record.",
        minWidth: "30rem",
      },
      ctx,
    ),
    rental: table(
      "rental",
      {
        rows: newestFirst(state.rentalCharges, (c) => c.chargedAt),
        columns: rentalColumns,
        rowKey: (c) => c.id,
        matchIds: (c) => [c.id],
        empty: "No rental charges yet.",
        minWidth: "30rem",
      },
      ctx,
    ),
    payouts: table(
      "payouts",
      {
        rows: newestFirst(state.payouts, (p) => p.createdAt),
        columns: payoutColumns,
        rowKey: (p) => p.id,
        matchIds: (p) => [p.id],
        empty: "No payouts yet. Cashback, rent refunds and settlement retries Closr sends appear here.",
        minWidth: "30rem",
      },
      ctx,
    ),
    offers: table(
      "offers",
      {
        // Offers already sent come first: they are the ones a customer may ask about.
        rows: newestFirst(state.offers, (o) => o.sentAt),
        columns: offerColumns,
        rowKey: (o) => o.id,
        matchIds: (o) => [o.id],
        empty: "No offers. After a fix, Closr may send one relevant offer to the customer's app.",
        minWidth: "30rem",
      },
      ctx,
    ),
    helpdesk: table(
      "helpdesk",
      {
        rows: newestFirst(state.tickets, (t) => t.updatedAt ?? t.createdAt),
        columns: ticketColumns,
        rowKey: (t) => t.id,
        matchIds: (t) => [t.id],
        empty: "No tickets yet.",
        minWidth: "30rem",
      },
      ctx,
    ),
  };
}
