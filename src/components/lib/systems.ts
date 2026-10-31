import {
  ArrowLeftRight,
  Banknote,
  CalendarClock,
  Gift,
  Globe,
  HandCoins,
  Landmark,
  LifeBuoy,
  type LucideIcon,
  QrCode,
  Receipt,
  Scale,
  ScrollText,
  Speaker,
  Tag,
  UserRound,
} from "lucide-react";
import type { ConsoleState, Moment, ProfileKind, SystemName } from "@/lib/types";
import { type RecordHit, findRecord } from "./records";

export const SYSTEMS: Record<SystemName, { label: string; icon: LucideIcon }> = {
  crm: { label: "CRM", icon: UserRound },
  upi: { label: "UPI", icon: ArrowLeftRight },
  settlements: { label: "Settlements", icon: Landmark },
  devices: { label: "Soundbox", icon: Speaker },
  billing: { label: "Billing", icon: Receipt },
  rewards: { label: "Rewards", icon: Gift },
  lending: { label: "Lending", icon: HandCoins },
  payouts: { label: "Payouts", icon: Banknote },
  sales: { label: "Sales", icon: Tag },
  helpdesk: { label: "Helpdesk", icon: LifeBuoy },
  policy: { label: "Policy", icon: ScrollText },
  web: { label: "Official sources", icon: Globe },
};

export function systemOf(name: string | undefined): { label: string; icon: LucideIcon } | undefined {
  return name && name in SYSTEMS ? SYSTEMS[name as SystemName] : undefined;
}

export type TabId =
  | "upi"
  | "disputes"
  | "followups"
  | "rewards"
  | "loans"
  | "collections"
  | "settlements"
  | "devices"
  | "rental"
  | "payouts"
  | "offers"
  | "helpdesk";

export const TABS: Record<TabId, { label: string; icon: LucideIcon }> = {
  upi: { label: "UPI", icon: ArrowLeftRight },
  disputes: { label: "Disputes", icon: Scale },
  followups: { label: "Follow-ups", icon: CalendarClock },
  rewards: { label: "Cashback", icon: Gift },
  loans: { label: "Loans", icon: HandCoins },
  collections: { label: "Collections", icon: QrCode },
  settlements: { label: "Settlements", icon: Landmark },
  devices: { label: "Soundbox", icon: Speaker },
  rental: { label: "Rental", icon: Receipt },
  payouts: { label: "Payouts", icon: Banknote },
  offers: { label: "Offers", icon: Tag },
  helpdesk: { label: "Helpdesk", icon: LifeBuoy },
};

export const PROFILE_TABS: Record<ProfileKind, TabId[]> = {
  consumer: ["upi", "disputes", "followups", "rewards", "loans", "payouts", "offers", "helpdesk"],
  merchant: ["collections", "settlements", "devices", "rental", "payouts", "offers", "helpdesk"],
};

const SYSTEM_TAB: Record<ProfileKind, Partial<Record<SystemName, TabId>>> = {
  consumer: { upi: "upi", rewards: "rewards", lending: "loans", payouts: "payouts", sales: "offers", helpdesk: "helpdesk" },
  merchant: {
    upi: "collections",
    settlements: "settlements",
    devices: "devices",
    billing: "rental",
    payouts: "payouts",
    sales: "offers",
    helpdesk: "helpdesk",
  },
};

function tabOfRecord(hit: RecordHit, kindOf: (customerId: string) => ProfileKind | undefined): TabId | null {
  switch (hit.type) {
    case "transaction":
      return kindOf(hit.record.customerId) === "merchant" ? "collections" : "upi";
    case "dispute":
      return "disputes";
    case "settlement":
      return "settlements";
    case "device":
      return "devices";
    case "rentalCharge":
      return "rental";
    case "reward":
      return "rewards";
    case "loan":
      return "loans";
    case "payout":
      return "payouts";
    case "ticket":
      return "helpdesk";
    case "offer":
      return "offers";
    case "followUp":
      return "followups";
    case "customer":
      return null;
  }
}

/** Which back-office tab shows the result of this moment. */
export function tabForMoment(moment: Moment, state: ConsoleState): TabId | null {
  const kindOf = (customerId: string) => state.customers.find((c) => c.id === customerId)?.kind;
  const callerId = state.call?.callRef === moment.callRef ? state.call.customerId : undefined;
  const kind = (callerId && kindOf(callerId)) || "consumer";
  const bySystem = moment.system ? SYSTEM_TAB[kind][moment.system] : undefined;
  const candidates = (moment.touched ?? []).flatMap((id) => {
    const hit = findRecord(state, id);
    const tab = hit ? tabOfRecord(hit, kindOf) : null;
    return tab ? [tab] : [];
  });
  // An action lists the record it created or changed first; anything else is best seen in its own system.
  if (moment.kind === "action" && candidates[0]) return candidates[0];
  if (bySystem && candidates.includes(bySystem)) return bySystem;
  return candidates[0] ?? bySystem ?? null;
}
