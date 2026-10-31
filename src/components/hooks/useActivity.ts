"use client";

import { useEffect, useRef, useState } from "react";
import type { ConsoleState, MomentKind } from "@/lib/types";
import { type TabId, tabForMoment } from "../lib/systems";

/** Record id → time (client clock) it was last touched or changed. */
export type Pulses = Record<string, number>;

export interface TabFocus {
  tab: TabId;
  seq: number;
}

export const PULSE_MS = 6000;
const KEEP_MS = 20000;
const FOCUS_KINDS: ReadonlySet<MomentKind> = new Set(["lookup", "action", "verified", "escalated"]);

function recordSignatures(state: ConsoleState): Map<string, string> {
  const out = new Map<string, string>();
  const collections: { id: string }[][] = [
    state.customers,
    state.transactions,
    state.disputes,
    state.settlements,
    state.devices,
    state.rentalCharges,
    state.rewards,
    state.loans,
    state.payouts,
    state.tickets,
  ];
  for (const rows of collections) for (const row of rows) out.set(row.id, JSON.stringify(row));
  return out;
}

export function isPulsing(pulses: Pulses, ids: readonly string[], now: number): number | undefined {
  let latest: number | undefined;
  for (const id of ids) {
    const at = pulses[id];
    if (at !== undefined && now - at < PULSE_MS && (latest === undefined || at > latest)) latest = at;
  }
  return latest;
}

/**
 * Watches successive console states and reports which records just changed, either because a
 * moment listed them in `touched` or because their contents differ from the previous poll.
 * The first state only primes the baseline so a page refresh doesn't light everything up.
 */
export function useActivity(state: ConsoleState, loaded: boolean): { pulses: Pulses; focus: TabFocus | null } {
  const [pulses, setPulses] = useState<Pulses>({});
  const [focus, setFocus] = useState<TabFocus | null>(null);
  const momentSeen = useRef(new Map<string, string>());
  const signatures = useRef(new Map<string, string>());
  const primed = useRef(false);

  useEffect(() => {
    if (!loaded) return;
    const fresh: string[] = [];
    let focusTab: TabId | null = null;

    for (const m of state.moments) {
      const touched = m.touched ?? [];
      const sig = `${m.status}|${touched.join(",")}`;
      const previous = momentSeen.current.get(m.id);
      if (previous === sig) continue;
      momentSeen.current.set(m.id, sig);
      if (!primed.current || m.status === "running") continue;
      fresh.push(...touched);
      if (FOCUS_KINDS.has(m.kind)) focusTab = tabForMoment(m, state) ?? focusTab;
    }

    for (const [id, sig] of recordSignatures(state)) {
      if (signatures.current.get(id) === sig) continue;
      signatures.current.set(id, sig);
      if (primed.current) fresh.push(id);
    }

    primed.current = true;

    if (fresh.length) {
      const now = Date.now();
      setPulses((prev) => {
        const next: Pulses = {};
        for (const [id, at] of Object.entries(prev)) if (now - at < KEEP_MS) next[id] = at;
        for (const id of fresh) next[id] = now;
        return next;
      });
    }
    if (focusTab) {
      const tab = focusTab;
      setFocus((prev) => ({ tab, seq: (prev?.seq ?? 0) + 1 }));
    }
  }, [state, loaded]);

  return { pulses, focus };
}
