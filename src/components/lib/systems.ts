import { CreditCard, Globe, LifeBuoy, type LucideIcon, Package, ScrollText, Truck, UserRound } from "lucide-react";
import type { ConsoleState, Moment, SystemName } from "@/lib/types";

export const SYSTEMS: Record<SystemName, { label: string; icon: LucideIcon }> = {
  crm: { label: "CRM", icon: UserRound },
  orders: { label: "Orders", icon: Package },
  courier: { label: "Courier", icon: Truck },
  payments: { label: "Payments", icon: CreditCard },
  helpdesk: { label: "Helpdesk", icon: LifeBuoy },
  policy: { label: "Policy", icon: ScrollText },
  web: { label: "Web", icon: Globe },
};

export function systemOf(name: string | undefined): { label: string; icon: LucideIcon } | undefined {
  return name && name in SYSTEMS ? SYSTEMS[name as SystemName] : undefined;
}

export type TabId = "orders" | "payments" | "courier" | "helpdesk" | "invoices";

const SYSTEM_TAB: Partial<Record<SystemName, TabId>> = {
  orders: "orders",
  payments: "payments",
  courier: "courier",
  helpdesk: "helpdesk",
};

function tabOfRecord(id: string, state: ConsoleState): TabId | null {
  if (state.refunds.some((r) => r.id === id)) return "payments";
  if (state.tickets.some((t) => t.id === id)) return "helpdesk";
  if (state.invoices.some((i) => i.id === id || i.number === id)) return "invoices";
  if (state.orders.some((o) => o.shipment?.awb === id)) return "courier";
  if (state.orders.some((o) => o.id === id)) return "orders";
  return null;
}

/** Which back-office tab shows the result of this moment. */
export function tabForMoment(moment: Moment, state: ConsoleState): TabId | null {
  const bySystem = moment.system ? SYSTEM_TAB[moment.system] : undefined;
  if (bySystem) return bySystem;
  for (const id of moment.touched ?? []) {
    const tab = tabOfRecord(id, state);
    if (tab) return tab;
  }
  return null;
}
