"use client";

import { CreditCard, FileText, LifeBuoy, type LucideIcon, Package, Truck } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ConsoleState, Customer, Invoice, Order, Refund, Shipment, Ticket } from "@/lib/types";
import { type Pulses, type TabFocus, isPulsing } from "./hooks/useActivity";
import { useNow } from "./hooks/useNow";
import { humanize, inr, shortDate, shortDateTime } from "./lib/format";
import type { TabId } from "./lib/systems";
import { type Column, RecordTable } from "./RecordTable";
import { StatusPill } from "./StatusPill";

interface ShipmentRow {
  order: Order;
  shipment: Shipment;
}

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "orders", label: "Orders", icon: Package },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "courier", label: "Courier", icon: Truck },
  { id: "helpdesk", label: "Helpdesk", icon: LifeBuoy },
  { id: "invoices", label: "Invoices", icon: FileText },
];

function newestFirst<T>(rows: T[], at: (row: T) => string | undefined): T[] {
  const time = (row: T) => {
    const t = Date.parse(at(row) ?? "");
    return Number.isFinite(t) ? t : 0;
  };
  return [...rows].sort((a, b) => time(b) - time(a));
}

function IdCell({ id, sub }: { id: string; sub?: ReactNode }) {
  return (
    <div>
      <p className="figures whitespace-nowrap font-semibold text-navy">{id}</p>
      {sub && <p className="figures whitespace-nowrap text-xs text-muted">{sub}</p>}
    </div>
  );
}

const dash = <span className="text-faint">—</span>;

interface Props {
  state: ConsoleState;
  callerId: string | undefined;
  callLive: boolean;
  pulses: Pulses;
  focus: TabFocus | null;
  className?: string;
}

export function BackOffice({ state, callerId, callLive, pulses, focus, className = "" }: Props) {
  const [active, setActive] = useState<TabId>("orders");
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const hasPulses = Object.keys(pulses).length > 0;
  const now = useNow(1000, hasPulses);

  useEffect(() => {
    if (focus) setActive(focus.tab);
  }, [focus]);

  const customers = useMemo(() => new Map<string, Customer>(state.customers.map((c) => [c.id, c])), [state.customers]);
  const orderOwner = useMemo(() => new Map<string, string>(state.orders.map((o) => [o.id, o.customerId])), [state.orders]);
  const caller = callerId ? customers.get(callerId) : undefined;
  const callerLabel = caller
    ? callLive
      ? `${caller.name}, on this call`
      : `${caller.name}, demo customer`
    : "On this call";

  const orders = useMemo(() => newestFirst(state.orders, (o) => o.placedAt), [state.orders]);
  const refunds = useMemo(() => newestFirst(state.refunds, (r) => r.createdAt), [state.refunds]);
  const tickets = useMemo(() => newestFirst(state.tickets, (t) => t.updatedAt ?? t.createdAt), [state.tickets]);
  const invoices = useMemo(() => newestFirst(state.invoices, (i) => i.issuedAt), [state.invoices]);
  const shipments = useMemo<ShipmentRow[]>(
    () => orders.filter((o) => o.shipment).map((o) => ({ order: o, shipment: o.shipment })),
    [orders],
  );

  const nameOf = (customerId: string | undefined) => (customerId ? customers.get(customerId)?.name : undefined);

  const orderColumns: Column<Order>[] = [
    { header: "Order", cell: (o) => <IdCell id={o.id} sub={shortDate(o.placedAt)} /> },
    { header: "Customer", minor: true, cell: (o) => nameOf(o.customerId) ?? o.customerId },
    {
      header: "Items",
      cell: (o) => {
        const items = o.items ?? [];
        const first = items[0];
        if (!first) return dash;
        return (
          <span className="block max-w-[16rem]">
            <span className="line-clamp-2">
              {first.name}
              {first.qty > 1 && <span className="text-muted"> ×{first.qty}</span>}
            </span>
            {items.length > 1 && <span className="text-xs text-muted">+{items.length - 1} more</span>}
          </span>
        );
      },
    },
    {
      header: "Total",
      align: "right",
      cell: (o) => (
        <div>
          <p className="font-medium">{inr(o.total)}</p>
          {o.payment?.method && <p className="text-xs text-muted">{o.payment.method}</p>}
        </div>
      ),
    },
    { header: "Status", cell: (o) => <StatusPill value={o.status} /> },
    {
      header: "Return QC",
      cell: (o) =>
        o.return ? (
          <div>
            <StatusPill value={o.return.qcStatus} />
            {o.return.qcSince && <p className="figures mt-0.5 text-xs text-muted">since {shortDate(o.return.qcSince)}</p>}
          </div>
        ) : (
          dash
        ),
    },
  ];

  const refundColumns: Column<Refund>[] = [
    { header: "Refund", cell: (r) => <IdCell id={r.id} sub={shortDateTime(r.createdAt)} /> },
    { header: "Order", cell: (r) => <span className="figures whitespace-nowrap">{r.orderId}</span> },
    { header: "Amount", align: "right", cell: (r) => <span className="font-semibold">{inr(r.amount)}</span> },
    { header: "Status", cell: (r) => <StatusPill value={r.status} /> },
    { header: "Method", minor: true, cell: (r) => r.method || dash },
    { header: "UTR", cell: (r) => (r.utr ? <span className="figures whitespace-nowrap">{r.utr}</span> : dash) },
    { header: "Expected by", cell: (r) => (r.expectedBy ? <span className="whitespace-nowrap">{shortDate(r.expectedBy)}</span> : dash) },
  ];

  const shipmentColumns: Column<ShipmentRow>[] = [
    { header: "AWB", cell: ({ shipment }) => <IdCell id={shipment.awb || "—"} sub={shipment.courier} /> },
    { header: "Order", cell: ({ order }) => <span className="figures whitespace-nowrap">{order.id}</span> },
    { header: "Status", cell: ({ shipment }) => <StatusPill value={shipment.status} /> },
    {
      header: "ETA",
      minor: true,
      cell: ({ shipment }) =>
        shipment.eta || shipment.slot ? (
          <div className="whitespace-nowrap">
            {shipment.eta && <p>{shortDate(shipment.eta)}</p>}
            {shipment.slot && <p className="text-xs text-muted">{shipment.slot}</p>}
          </div>
        ) : (
          dash
        ),
    },
    {
      header: "Latest scan",
      cell: ({ shipment }) => {
        const latest = newestFirst(shipment.events ?? [], (e) => e.at)[0];
        if (!latest) return dash;
        return (
          <div className="max-w-[15rem]">
            <p className="line-clamp-2">{latest.status}</p>
            <p className="figures text-xs text-muted">
              {latest.location}, {shortDateTime(latest.at)}
            </p>
          </div>
        );
      },
    },
  ];

  const ticketColumns: Column<Ticket>[] = [
    { header: "Ticket", cell: (t) => <IdCell id={t.id} sub={t.orderId} /> },
    {
      header: "Subject",
      cell: (t) => {
        const note = t.notes?.at(-1);
        return (
          <div className="max-w-[20rem]">
            <p className="font-medium">{t.subject}</p>
            {note && <p className="line-clamp-2 text-xs text-muted">{note}</p>}
          </div>
        );
      },
    },
    { header: "Customer", minor: true, cell: (t) => nameOf(t.customerId) ?? t.customerId },
    {
      header: "Priority",
      cell: (t) => (
        <span className={t.priority === "high" ? "font-semibold text-brick" : "text-ink"}>{humanize(t.priority ?? "normal")}</span>
      ),
    },
    { header: "Status", cell: (t) => <StatusPill value={t.status} /> },
    {
      header: "Updated",
      cell: (t) => <span className="figures whitespace-nowrap">{shortDateTime(t.updatedAt ?? t.createdAt)}</span>,
    },
  ];

  const invoiceColumns: Column<Invoice>[] = [
    { header: "Invoice", cell: (i) => <IdCell id={i.number || i.id} sub={i.number ? i.id : undefined} /> },
    { header: "Order", cell: (i) => <span className="figures whitespace-nowrap">{i.orderId}</span> },
    { header: "Subtotal", align: "right", minor: true, cell: (i) => inr(i.subtotal) },
    { header: "GST", align: "right", cell: (i) => inr(i.gst) },
    { header: "Total", align: "right", cell: (i) => <span className="font-semibold">{inr(i.total)}</span> },
    {
      header: "Issued",
      cell: (i) => (
        <div className="whitespace-nowrap">
          <p>{shortDate(i.issuedAt)}</p>
          {i.gstin && <p className="figures text-xs text-muted">{i.gstin}</p>}
        </div>
      ),
    },
  ];

  const orderIds = (o: Order) => [o.id];
  const refundIds = (r: Refund) => [r.id];
  const shipmentIds = ({ order, shipment }: ShipmentRow) => (shipment.awb ? [shipment.awb, order.id] : [order.id]);
  const ticketIds = (t: Ticket) => [t.id];
  const invoiceIds = (i: Invoice) => (i.number ? [i.id, i.number] : [i.id]);

  const counts: Record<TabId, number> = {
    orders: orders.length,
    payments: refunds.length,
    courier: shipments.length,
    helpdesk: tickets.length,
    invoices: invoices.length,
  };

  const hot: Record<TabId, boolean> = {
    orders: orders.some((o) => isPulsing(pulses, orderIds(o), now) !== undefined),
    payments: refunds.some((r) => isPulsing(pulses, refundIds(r), now) !== undefined),
    courier: shipments.some((s) => isPulsing(pulses, shipmentIds(s), now) !== undefined),
    helpdesk: tickets.some((t) => isPulsing(pulses, ticketIds(t), now) !== undefined),
    invoices: invoices.some((i) => isPulsing(pulses, invoiceIds(i), now) !== undefined),
  };

  const shared = { callerLabel, pulses, now };

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === active);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].id;
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <section aria-labelledby="backoffice-heading" className={`flex flex-col border-rule bg-sheet lg:min-h-0 lg:border-l ${className}`}>
      <header className="@container px-5 pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="backoffice-heading" className="font-serif text-[1.625rem] font-semibold leading-tight text-navy">
            Back office
          </h2>
          <p className="text-[15px] text-muted">Records change here as Closr acts</p>
        </div>
        <div role="tablist" aria-label="Systems" className="-mx-1 mt-3 flex gap-0.5 overflow-x-auto border-b border-rule px-1 [scrollbar-width:none]">
          {TABS.map((tab) => {
            const selected = tab.id === active;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(tab.id)}
                onKeyDown={onTabKey}
                className={`relative -mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[14px] font-medium transition-colors @xl:gap-2 @xl:px-3 @xl:text-[15px] ${
                  selected ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <Icon aria-hidden size={15} strokeWidth={2.25} className="hidden @xl:block" />
                {tab.label}
                <span className="figures text-xs text-faint">{counts[tab.id]}</span>
                {hot[tab.id] && !selected && (
                  <span className="live-dot absolute right-1 top-1.5 size-2 rounded-full bg-sky" aria-label="Just changed" />
                )}
              </button>
            );
          })}
        </div>
      </header>

      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        className="scrollbar-quiet @container overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
      >
        {active === "orders" && (
          <RecordTable
            {...shared}
            rows={orders}
            columns={orderColumns}
            rowKey={(o) => o.id}
            matchIds={orderIds}
            isCaller={(o) => o.customerId === callerId}
            empty="No orders yet."
            minWidth="30rem"
          />
        )}
        {active === "payments" && (
          <RecordTable
            {...shared}
            rows={refunds}
            columns={refundColumns}
            rowKey={(r) => r.id}
            matchIds={refundIds}
            isCaller={(r) => orderOwner.get(r.orderId) === callerId}
            empty="No refunds yet. When Closr issues one, it appears here."
            minWidth="32rem"
          />
        )}
        {active === "courier" && (
          <RecordTable
            {...shared}
            rows={shipments}
            columns={shipmentColumns}
            rowKey={({ order }) => order.id}
            matchIds={shipmentIds}
            isCaller={({ order }) => order.customerId === callerId}
            empty="No shipments yet."
            minWidth="30rem"
          />
        )}
        {active === "helpdesk" && (
          <RecordTable
            {...shared}
            rows={tickets}
            columns={ticketColumns}
            rowKey={(t) => t.id}
            matchIds={ticketIds}
            isCaller={(t) => t.customerId === callerId}
            empty="No tickets yet."
            minWidth="30rem"
          />
        )}
        {active === "invoices" && (
          <RecordTable
            {...shared}
            rows={invoices}
            columns={invoiceColumns}
            rowKey={(i) => i.id}
            matchIds={invoiceIds}
            isCaller={(i) => i.customerId === callerId}
            empty="No invoices yet."
            minWidth="30rem"
          />
        )}
      </div>
    </section>
  );
}
