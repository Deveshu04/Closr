import { CASHBACK_AUTO_LIMIT, RENT_REFUND_AUTO_LIMIT, SETTLEMENT_RETRY_AUTO_LIMIT } from "@/lib/policy";
import type { AutonomyLevel, Workflow } from "@/lib/types";

export const WORKFLOWS: { id: Workflow; label: string; limit: number }[] = [
  { id: "cashback", label: "Cashback", limit: CASHBACK_AUTO_LIMIT },
  { id: "rent_refunds", label: "Rent refunds", limit: RENT_REFUND_AUTO_LIMIT },
  { id: "settlement_retries", label: "Settlement retries", limit: SETTLEMENT_RETRY_AUTO_LIMIT },
];

/** Mirrors the server default, so the dial shows something sensible before the first state arrives. */
export const DEFAULT_AUTONOMY: Record<Workflow, AutonomyLevel> = { cashback: 2, rent_refunds: 2, settlement_retries: 2 };

export const LEVELS: Record<AutonomyLevel, { code: string; name: string; meaning: string }> = {
  0: { code: "L0", name: "Shadow", meaning: "Closr suggests, a specialist acts" },
  1: { code: "L1", name: "Approve", meaning: "Every payout waits for one tap" },
  2: { code: "L2", name: "Auto", meaning: "Acts alone within the limit, asks above it" },
  3: { code: "L3", name: "Autonomous", meaning: "Acts alone even above the limit; risk reviews still go to a person" },
};

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export function readAutonomy(raw: unknown): Record<Workflow, AutonomyLevel> {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_AUTONOMY };
  for (const { id } of WORKFLOWS) {
    const level = source[id];
    if (isAutonomyLevel(level)) out[id] = level;
  }
  return out;
}
