"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { CallRecord } from "@/lib/types";
import { startCall } from "../lib/api";
import { normalizeIndianMobile } from "../lib/phone";
import { useNow } from "./useNow";

export type CallPhase = CallRecord["status"] | "idle";

export const LIVE_PHASES: ReadonlySet<CallPhase> = new Set<CallPhase>(["dialing", "ringing", "in_progress"]);
/** A call stuck "active" this long almost certainly lost its final webhook; let the caller dial again. */
const STALE_MS = 10 * 60_000;
const PENDING_TIMEOUT_MS = 30_000;
const PHONE_KEY = "closr.lastPhone";

export interface CallRequest {
  phoneInput: string;
  setPhoneInput: (value: string) => void;
  /** The input as +91XXXXXXXXXX, or null while it isn't a valid Indian mobile. */
  phone: string | null;
  showInvalid: boolean;
  onPhoneBlur: () => void;
  starting: boolean;
  error: string | null;
  /** Between a successful request and the new call appearing in state; `call` is still the previous one. */
  pending: boolean;
  phase: CallPhase;
  live: boolean;
  stale: boolean;
  busy: boolean;
  /** Time on the call so far, or its total length once ended; null when unknown. */
  elapsed: number | null;
  submit: (e: FormEvent<HTMLFormElement>) => Promise<void>;
}

/** Phone entry, the call-back request and live call timing, shared by the care console and the customer app. */
export function useCallRequest(call: CallRecord | null, refresh: () => void): CallRequest {
  const [phoneInput, setInput] = useState("");
  const [blurred, setBlurred] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ callRef?: string; at: number } | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PHONE_KEY);
      if (saved) setInput(saved);
    } catch {
      // Storage can be blocked (private mode, policy); the field just starts empty.
    }
  }, []);

  useEffect(() => {
    if (!pending) return;
    const arrived = call && (pending.callRef ? call.callRef === pending.callRef : LIVE_PHASES.has(call.status));
    if (arrived) {
      setPending(null);
      return;
    }
    const timer = setTimeout(() => setPending(null), Math.max(0, PENDING_TIMEOUT_MS - (Date.now() - pending.at)));
    return () => clearTimeout(timer);
  }, [pending, call]);

  const phone = normalizeIndianMobile(phoneInput);
  const phase: CallPhase = pending ? "dialing" : (call?.status ?? "idle");
  const live = LIVE_PHASES.has(phase);
  const now = useNow(1000, live);
  const startedAt = pending ? pending.at : call ? Date.parse(call.startedAt) : NaN;
  const endedAt = !pending && call?.endedAt ? Date.parse(call.endedAt) : NaN;
  const stale = live && !pending && Number.isFinite(startedAt) && now - startedAt > STALE_MS;
  const busy = starting || (live && !stale);
  const elapsed = !Number.isFinite(startedAt)
    ? null
    : live
      ? now - startedAt
      : Number.isFinite(endedAt)
        ? endedAt - startedAt
        : null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBlurred(true);
    if (!phone || busy) return;
    setStarting(true);
    setError(null);
    try {
      window.localStorage.setItem(PHONE_KEY, phone);
    } catch {
      // Remembering the number is a convenience only.
    }
    const result = await startCall(phone);
    setStarting(false);
    if (result.ok) setPending({ callRef: result.callRef, at: Date.now() });
    else setError(result.error);
    refresh();
  }

  return {
    phoneInput,
    setPhoneInput: (value) => {
      setInput(value);
      setError(null);
    },
    phone,
    showInvalid: blurred && phoneInput.trim() !== "" && !phone,
    onPhoneBlur: () => setBlurred(true),
    starting,
    error,
    pending: pending !== null,
    phase,
    live,
    stale,
    busy,
    elapsed,
    submit,
  };
}
