"use client";

import { useEffect, useState } from "react";
import type { OutcomeMetrics } from "@/lib/types";
import { isRecord, pickNumber } from "../lib/data";

const REFRESH_MS = 3000;

function readMetrics(raw: unknown): OutcomeMetrics | null {
  if (!isRecord(raw)) return null;
  const count = (key: string) => pickNumber(raw, key) ?? 0;
  const approvals = isRecord(raw.approvals) ? raw.approvals : {};
  return {
    conversations: count("conversations"),
    resolvedAutonomously: count("resolvedAutonomously"),
    verifiedResolutions: count("verifiedResolutions"),
    escalations: count("escalations"),
    approvals: {
      requested: pickNumber(approvals, "requested") ?? 0,
      approved: pickNumber(approvals, "approved") ?? 0,
      denied: pickNumber(approvals, "denied") ?? 0,
    },
    moneyReturned: count("moneyReturned"),
    disputesRaised: count("disputesRaised"),
    avgResolutionSec: pickNumber(raw, "avgResolutionSec") ?? null,
    autonomousRate: pickNumber(raw, "autonomousRate") ?? null,
  };
}

/** Outcome numbers, refetched every few seconds and at once whenever `trigger` changes (a call starting or ending). */
export function useMetrics(trigger: string): OutcomeMetrics | null {
  const [metrics, setMetrics] = useState<OutcomeMetrics | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch("/api/metrics", { cache: "no-store" });
        const next = res.ok ? readMetrics(await res.json()) : null;
        // A failed refresh keeps the last numbers on screen rather than blanking the strip.
        if (next && !stopped) setMetrics(next);
      } catch {
        // Same: the strip holds its last good numbers until the server answers again.
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [trigger]);

  return metrics;
}
