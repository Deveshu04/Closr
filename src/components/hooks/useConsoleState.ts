"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CallRecord, ConsoleState } from "@/lib/types";

export const EMPTY_STATE: ConsoleState = {
  call: null,
  moments: [],
  approvals: [],
  customers: [],
  orders: [],
  refunds: [],
  tickets: [],
  invoices: [],
};

const REQUEST_TIMEOUT_MS = 4000;
const FAILURES_BEFORE_OFFLINE = 4;

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalize(raw: unknown): ConsoleState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const call = typeof r.call === "object" && r.call !== null ? (r.call as CallRecord) : null;
  return {
    call,
    moments: list(r.moments),
    approvals: list(r.approvals),
    customers: list(r.customers),
    orders: list(r.orders),
    refunds: list(r.refunds),
    tickets: list(r.tickets),
    invoices: list(r.invoices),
  };
}

export interface ConsoleFeed {
  state: ConsoleState;
  /** True once the first good response has arrived. */
  loaded: boolean;
  reachable: boolean;
  refresh: () => void;
}

export function useConsoleState(intervalMs = 700): ConsoleFeed {
  const [state, setState] = useState<ConsoleState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const [reachable, setReachable] = useState(true);
  const lastBody = useRef("");
  const failures = useRef(0);
  const issued = useRef(0);
  const applied = useRef(0);

  const poll = useCallback(async () => {
    const ticket = ++issued.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/state", { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`state ${res.status}`);
      const body = await res.text();
      // A manual refresh can overtake a slow poll; never let the older answer win.
      if (ticket < applied.current) return;
      const next = body === lastBody.current ? null : normalize(JSON.parse(body));
      applied.current = ticket;
      failures.current = 0;
      setReachable(true);
      setLoaded(true);
      if (next) {
        lastBody.current = body;
        setState(next);
      }
    } catch {
      failures.current += 1;
      if (failures.current >= FAILURES_BEFORE_OFFLINE) setReachable(false);
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await poll();
      if (!stopped) timer = setTimeout(loop, intervalMs);
    };
    void loop();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [poll, intervalMs]);

  const refresh = useCallback(() => {
    void poll();
  }, [poll]);

  return { state, loaded, reachable, refresh };
}
