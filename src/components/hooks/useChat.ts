"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CallRecord, Moment, ProfileKind } from "@/lib/types";
import type { Step } from "../customer/story";
import { endChat, sendChatMessage, startChat } from "../lib/api";

export const MAX_MESSAGE_LENGTH = 500;
const STORAGE_KEY = "closr.chat";
/** The greeting's turn: moments recorded while the chat opens sit above it. */
const GREETING = "greeting";
/**
 * The state poll trails the reply by up to one interval, so a moment first seen this soon after a
 * reply was almost certainly made before it and belongs above it.
 */
const LATE_MOMENT_MS = 3000;

export interface ChatMessage {
  id: string;
  from: "customer" | "closr";
  text: string;
  at: string;
  /** The customer message this is or answers; GREETING for Closr's opening line. */
  turn: string;
  failed?: boolean;
}

interface Anchor {
  turn: string;
  /** Seen while nothing was in flight, so it goes after that turn's reply. */
  late: boolean;
}

export interface ChatSession {
  sessionRef: string;
  profile: ProfileKind;
  customerId?: string;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  messages: ChatMessage[];
  suggestions: string[];
  anchors: Record<string, Anchor>;
  /** The last copy of each of this session's moments; the console state drops them once another call starts. */
  moments: Record<string, Moment>;
}

export type ChatPhase = "idle" | "starting" | "open" | "ended";

export interface Chat {
  phase: ChatPhase;
  /** The app the chat belongs to, once one is started. */
  profile: ProfileKind | null;
  session: ChatSession | null;
  /** The customer message Closr is working on, if any. */
  pending: string | null;
  ending: boolean;
  error: string | null;
  start: (profile: ProfileKind) => void;
  /** False when the message can't be sent right now, so the composer keeps the text. */
  send: (text: string) => boolean;
  retry: () => void;
  end: () => Promise<boolean>;
  close: () => void;
}

function newId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Network and server wording isn't for customers; known, meaningful errors pass through. */
function friendly(error: string, fallback: string): string {
  return /didn't answer|\(\d{3}\)$|fetch|network/i.test(error) ? fallback : error;
}

function readSaved(): ChatSession | null {
  try {
    const raw: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const s = raw as Partial<ChatSession>;
    const valid =
      typeof s.sessionRef === "string" &&
      (s.profile === "consumer" || s.profile === "merchant") &&
      typeof s.startedAt === "string" &&
      Array.isArray(s.messages) &&
      Array.isArray(s.suggestions) &&
      typeof s.anchors === "object" &&
      typeof s.moments === "object";
    return valid ? (s as ChatSession) : null;
  } catch {
    return null;
  }
}

function save(session: ChatSession | null): void {
  try {
    if (session) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage a reload just starts over; the chat itself still works.
  }
}

function latestTurn(messages: ChatMessage[]): string {
  return messages.findLast((m) => m.from === "customer")?.id ?? GREETING;
}

/**
 * A chat session in the customer app: messages, the console moments each message set off, and the
 * session's lifecycle. Survives a reload of the tab through sessionStorage.
 */
export function useChat(call: CallRecord | null, moments: Moment[], loaded: boolean, refresh: () => void): Chat {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [profile, setProfile] = useState<ProfileKind | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The open session's ref; null once it ends, so late replies are dropped. */
  const active = useRef<string | null>(null);
  const inflight = useRef<string | null>(null);
  const lastReply = useRef<{ turn: string; at: number } | null>(null);
  /** Right after start the poll can still show the previous call; only a session the server has shown can go missing. */
  const seenOnServer = useRef(false);
  /** Bumped by every start and close, so a start that resolves after the customer left is dropped. */
  const generation = useRef(0);
  /** The server allows one live session, so a second start (a double tap) would only fail. */
  const startInFlight = useRef(false);

  useEffect(() => {
    const saved = readSaved();
    if (!saved) return;
    setSession(saved);
    setProfile(saved.profile);
    setPhase(saved.endedAt ? "ended" : "open");
    if (!saved.endedAt) {
      active.current = saved.sessionRef;
      seenOnServer.current = true;
    }
  }, []);

  useEffect(() => {
    if (session) save(session);
  }, [session]);

  const finish = useCallback((endedAt?: string) => {
    active.current = null;
    inflight.current = null;
    setPending(null);
    setPhase("ended");
    setSession((s) => (s && !s.endedAt ? { ...s, endedAt: endedAt ?? new Date().toISOString() } : s));
  }, []);

  // Keep what the server knows about the session, and notice when it ends there.
  useEffect(() => {
    if (!loaded || !session || session.endedAt) return;
    if (call?.callRef === session.sessionRef) {
      seenOnServer.current = true;
      if (call.customerId && call.customerId !== session.customerId) {
        setSession((s) => (s ? { ...s, customerId: call.customerId } : s));
      }
      if (call.status === "completed" || call.status === "failed") {
        setSession((s) => (s ? { ...s, durationSec: call.durationSec } : s));
        finish(call.endedAt);
      }
      return;
    }
    if (seenOnServer.current) finish();
  }, [loaded, call, session, finish]);

  const sessionRef = session?.sessionRef;
  useEffect(() => {
    if (!sessionRef) return;
    const mine = moments.filter((m) => m.callRef === sessionRef);
    if (mine.length === 0) return;
    setSession((prev) => {
      if (!prev || prev.sessionRef !== sessionRef) return prev;
      let changed = false;
      const kept = { ...prev.moments };
      const anchors = { ...prev.anchors };
      for (const m of mine) {
        if (JSON.stringify(prev.moments[m.id]) !== JSON.stringify(m)) {
          kept[m.id] = m;
          changed = true;
        }
        if (anchors[m.id]) continue;
        const recent = lastReply.current && Date.now() - lastReply.current.at < LATE_MOMENT_MS ? lastReply.current : null;
        anchors[m.id] = inflight.current
          ? { turn: inflight.current, late: false }
          : recent
            ? { turn: recent.turn, late: false }
            : { turn: latestTurn(prev.messages), late: true };
        changed = true;
      }
      return changed ? { ...prev, moments: kept, anchors } : prev;
    });
  }, [moments, sessionRef]);

  const start = useCallback(
    async (kind: ProfileKind) => {
      if (startInFlight.current) return;
      startInFlight.current = true;
      const ticket = ++generation.current;
      active.current = null;
      inflight.current = GREETING;
      lastReply.current = null;
      seenOnServer.current = false;
      save(null);
      setSession(null);
      setProfile(kind);
      setPhase("starting");
      setPending(GREETING);
      setError(null);

      const result = await startChat(kind);
      startInFlight.current = false;
      refresh();
      if (ticket !== generation.current) {
        if (result.ok) void endChat(result.sessionRef);
        return;
      }
      inflight.current = null;
      setPending(null);
      if (!result.ok) {
        setError(friendly(result.error, "Closr isn't reachable right now. Please try again in a moment."));
        return;
      }
      const at = new Date().toISOString();
      active.current = result.sessionRef;
      lastReply.current = { turn: GREETING, at: Date.now() };
      setSession({
        sessionRef: result.sessionRef,
        profile: kind,
        startedAt: at,
        messages: result.reply ? [{ id: newId(), from: "closr", text: result.reply, at, turn: GREETING }] : [],
        suggestions: result.suggestions,
        anchors: {},
        moments: {},
      });
      setPhase("open");
    },
    [refresh],
  );

  const deliver = useCallback(
    async (message: ChatMessage, ref: string) => {
      inflight.current = message.turn;
      setPending(message.turn);
      setError(null);
      const result = await sendChatMessage(ref, message.text);
      refresh();
      if (active.current !== ref) return;
      inflight.current = null;
      setPending(null);

      if (!result.ok) {
        if (/chat has ended/i.test(result.error)) return finish();
        setSession((s) =>
          s?.sessionRef === ref ? { ...s, messages: s.messages.map((m) => (m.id === message.id ? { ...m, failed: true } : m)) } : s,
        );
        setError(friendly(result.error, "Your message didn't reach Closr. Check your connection and try again."));
        return;
      }
      lastReply.current = { turn: message.turn, at: Date.now() };
      const reply: ChatMessage[] = result.reply
        ? [{ id: newId(), from: "closr", text: result.reply, at: new Date().toISOString(), turn: message.turn }]
        : [];
      setSession((s) =>
        s?.sessionRef === ref ? { ...s, messages: [...s.messages, ...reply], suggestions: result.suggestions } : s,
      );
      if (result.ended) finish();
    },
    [refresh, finish],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim().slice(0, MAX_MESSAGE_LENGTH);
      const ref = active.current;
      if (!text || !ref || inflight.current) return false;
      const id = newId();
      const message: ChatMessage = { id, from: "customer", text, at: new Date().toISOString(), turn: id };
      // A failed message stays in the transcript, marked unsent, when the customer types a new one instead.
      setSession((s) => (s ? { ...s, messages: [...s.messages, message], suggestions: [] } : s));
      void deliver(message, ref);
      return true;
    },
    [deliver],
  );

  const retry = useCallback(() => {
    const ref = active.current;
    const failed = session?.messages.findLast((m) => m.failed);
    if (!ref || !failed || inflight.current) return;
    setSession((s) => (s ? { ...s, messages: s.messages.map((m) => (m.id === failed.id ? { ...m, failed: false } : m)) } : s));
    void deliver({ ...failed, failed: false }, ref);
  }, [session, deliver]);

  const end = useCallback(async () => {
    const ref = active.current;
    if (!ref) return true;
    setEnding(true);
    const result = await endChat(ref);
    setEnding(false);
    refresh();
    if (!result.ok) {
      setError("Couldn't end the chat. Check your connection and try again.");
      return false;
    }
    setError(null);
    finish();
    return true;
  }, [refresh, finish]);

  const close = useCallback(() => {
    generation.current += 1;
    active.current = null;
    inflight.current = null;
    save(null);
    setSession(null);
    setProfile(null);
    setPhase("idle");
    setPending(null);
    setError(null);
  }, []);

  return {
    phase,
    profile,
    session,
    pending,
    ending,
    error,
    start: (kind) => void start(kind),
    send,
    retry,
    end,
    close,
  };
}

export type ChatEntry =
  | { type: "message"; message: ChatMessage }
  | { type: "step"; step: Step; confirmations: Step[] };

/** Messages in order, with the cards for what Closr did placed between each message and its reply. */
export function chatTimeline(session: ChatSession, steps: Step[]): ChatEntry[] {
  const fallback = latestTurn(session.messages);
  const buckets = new Map<string, { before: Step[]; after: Step[] }>();
  for (const step of steps) {
    if (step.kind === "call") continue;
    const anchor = session.anchors[step.id] ?? { turn: fallback, late: true };
    const bucket = buckets.get(anchor.turn) ?? { before: [], after: [] };
    (anchor.late ? bucket.after : bucket.before).push(step);
    buckets.set(anchor.turn, bucket);
  }

  const out: ChatEntry[] = [];
  const pushSteps = (list: Step[] | undefined) => {
    for (const step of list ?? []) {
      const previous = out.at(-1);
      if (step.minor && previous?.type === "step") previous.confirmations.push(step);
      else out.push({ type: "step", step, confirmations: [] });
    }
  };
  const turns = [GREETING, ...session.messages.filter((m) => m.from === "customer").map((m) => m.id)];
  for (const turn of turns) {
    const own = session.messages.find((m) => m.id === turn);
    if (own) out.push({ type: "message", message: own });
    pushSteps(buckets.get(turn)?.before);
    for (const m of session.messages) if (m.from === "closr" && m.turn === turn) out.push({ type: "message", message: m });
    pushSteps(buckets.get(turn)?.after);
  }
  return out;
}

/** The steps Closr has taken so far on the message it is working on. */
export function stepsForTurn(session: ChatSession | null, steps: Step[], turn: string | null): Step[] {
  if (!session || !turn) return [];
  return steps.filter((s) => s.kind !== "call" && session.anchors[s.id]?.turn === turn && !session.anchors[s.id]?.late);
}
