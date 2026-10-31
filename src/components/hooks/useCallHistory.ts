"use client";

import { useEffect, useState } from "react";
import type { CallRecord } from "@/lib/types";
import { pickNumber, pickString } from "../lib/data";
import { RATINGS_KEY, type Ratings, readRatings } from "../lib/ratings";
import { type Channel, channelOf } from "../lib/records";

/** One row of GET /api/calls. */
export interface PastCall {
  callRef: string;
  channel: Channel;
  customerName: string;
  phone: string;
  status: CallRecord["status"];
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  hasTranscript: boolean;
  actions: number;
}

const REFRESH_MS = 10_000;
const STATUSES: ReadonlySet<string> = new Set(["dialing", "ringing", "in_progress", "completed", "failed"]);

function readCalls(raw: unknown): PastCall[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const list = (raw as { calls?: unknown }).calls;
  if (!Array.isArray(list)) return null;
  return list.flatMap((entry): PastCall[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const callRef = pickString(row, "callRef");
    const startedAt = pickString(row, "startedAt");
    const status = pickString(row, "status");
    if (!callRef || !startedAt || !status || !STATUSES.has(status)) return [];
    return [
      {
        callRef,
        channel: channelOf(row),
        customerName: pickString(row, "customerName") ?? "Unidentified caller",
        phone: pickString(row, "phone") ?? "",
        status: status as PastCall["status"],
        startedAt,
        endedAt: pickString(row, "endedAt"),
        durationSec: pickNumber(row, "durationSec"),
        hasTranscript: row.hasTranscript === true,
        actions: pickNumber(row, "actions") ?? 0,
      },
    ];
  });
}

export interface CallHistory {
  calls: PastCall[];
  /** Star ratings customers left in this browser's customer view. */
  ratings: Ratings;
  loaded: boolean;
  failed: boolean;
}

/** Recent calls, newest first. Refetches when `trigger` changes (a call starting or ending) and every few seconds. */
export function useCallHistory(trigger: string): CallHistory {
  const [calls, setCalls] = useState<PastCall[]>([]);
  const [ratings, setRatings] = useState<Ratings>({});
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch("/api/calls", { cache: "no-store" });
        const next = res.ok ? readCalls(await res.json()) : null;
        if (stopped) return;
        if (next) {
          setCalls([...next].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)));
          setFailed(false);
        } else {
          setFailed(true);
        }
      } catch {
        if (!stopped) setFailed(true);
      } finally {
        if (!stopped) setLoaded(true);
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [trigger]);

  useEffect(() => {
    setRatings(readRatings());
    const onStorage = (e: StorageEvent) => {
      if (e.key === RATINGS_KEY || e.key === null) setRatings(readRatings());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { calls, ratings, loaded, failed };
}
