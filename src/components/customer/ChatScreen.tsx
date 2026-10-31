"use client";

import { CircleAlert, LoaderCircle, Lock, RefreshCw, SendHorizontal, WifiOff, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ProfileKind } from "@/lib/types";
import { ClosrMark } from "../brand/ClosrMark";
import { type Chat, type ChatMessage, MAX_MESSAGE_LENGTH, chatTimeline, stepsForTurn } from "../hooks/useChat";
import { timeOfDay } from "../lib/format";
import { chronological } from "../lib/moments";
import { CallResolution } from "./CallResolution";
import { ChatCard } from "./ChatCard";
import { type CallerRecords, type Step, customerFeed, summarizeCall } from "./story";

const TEXT_SIZE_KEY = "closr.chatTextSize";
const STICK_THRESHOLD_PX = 120;
const COUNTER_FROM = 400;

const FALLBACK_SUGGESTIONS: Record<ProfileKind, string[]> = {
  consumer: ["Money debited but not received", "Cashback not credited", "EMI deducted twice"],
  merchant: ["Soundbox not announcing payments", "Settlement not received", "Rent charged after returning device"],
};

type TextSize = "standard" | "large";
const FONT_SIZE: Record<TextSize, string> = { standard: "text-[15px]", large: "text-[18px]" };

function useTextSize(): [TextSize, (size: TextSize) => void] {
  const [size, setSize] = useState<TextSize>("standard");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TEXT_SIZE_KEY) === "large") setSize("large");
    } catch {
      // Storage can be blocked; standard size is the default.
    }
  }, []);
  const choose = useCallback((next: TextSize) => {
    setSize(next);
    try {
      window.localStorage.setItem(TEXT_SIZE_KEY, next);
    } catch {
      // Remembering the size is a convenience only.
    }
  }, []);
  return [size, choose];
}

/** The calm line beside the typing dots: the step in flight, else what Closr is doing in general. */
function workingLine(phase: Chat["phase"], steps: Step[]): string {
  if (phase === "starting") return "Connecting you to Closr…";
  const last = steps.at(-1);
  if (!last) return "Closr is reading your message…";
  if (last.tone === "progress") return last.text.endsWith("…") ? last.text : `${last.text}…`;
  if (last.tone === "waiting") return "Waiting for a Paytm specialist's approval…";
  return "Closr is writing a reply…";
}

function Avatar() {
  return (
    <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-navy text-white">
      <ClosrMark className="size-4" />
    </span>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.from === "customer";
  return (
    <div className={`flex items-end gap-2 ${mine ? "justify-end" : ""}`}>
      {!mine && <Avatar />}
      <div className={`flex min-w-0 max-w-[82%] flex-col ${mine ? "items-end" : "items-start"}`}>
        <p
          className={`whitespace-pre-wrap rounded-[1.25em] px-[0.9em] py-[0.6em] text-[1em] leading-[1.45] ${
            mine
              ? `rounded-br-[0.4em] bg-navy text-white ${message.failed ? "outline-2 outline-offset-2 outline-brick" : ""}`
              : "rounded-bl-[0.4em] bg-sheet text-ink shadow-[0_1px_2px_rgb(19_35_63/0.06)] ring-1 ring-rule"
          }`}
        >
          <span className="sr-only">{mine ? "You: " : "Closr: "}</span>
          {message.text}
        </p>
        <p className="figures mt-1 px-1 text-[0.75em] text-muted">
          {message.failed ? (
            <span className="inline-flex items-center gap-1 font-semibold text-brick">
              <CircleAlert aria-hidden className="size-[1.1em]" />
              Not sent
            </span>
          ) : (
            <time dateTime={message.at}>{timeOfDay(message.at)}</time>
          )}
        </p>
      </div>
    </div>
  );
}

function Working({ line }: { line: string }) {
  return (
    <div aria-hidden className="flex items-center gap-2">
      <Avatar />
      <span className="rounded-[1.25em] rounded-bl-[0.4em] bg-sheet px-[0.9em] py-[0.75em] ring-1 ring-rule">
        <span className="typing-dots">
          <span />
          <span />
          <span />
        </span>
      </span>
      <span className="min-w-0 text-[0.85em] leading-snug text-muted">{line}</span>
    </div>
  );
}

function TextSizeToggle({ value, onChange }: { value: TextSize; onChange: (size: TextSize) => void }) {
  const options: { size: TextSize; glyph: string; label: string }[] = [
    { size: "standard", glyph: "A", label: "Standard text size" },
    { size: "large", glyph: "A+", label: "Larger text size" },
  ];
  return (
    <div role="group" aria-label="Text size" className="flex shrink-0 rounded-full bg-sheet p-0.5 ring-1 ring-rule">
      {options.map((o) => {
        const selected = o.size === value;
        return (
          <button
            key={o.size}
            type="button"
            aria-pressed={selected}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.size)}
            className={`grid h-7 min-w-9 place-items-center rounded-full px-2 font-semibold leading-none transition-colors ${
              selected ? "bg-navy text-white" : "text-muted hover:text-navy"
            } ${o.size === "large" ? "text-[14px]" : "text-[12px]"}`}
          >
            <span aria-hidden>{o.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}

interface HeaderProps {
  status: string;
  working: boolean;
  ended: boolean;
  offline: boolean;
  /** Before the chat opens, or after it ends, there's nothing to end, only to close. */
  canEnd: boolean;
  onEnd: () => void;
  onClose: () => void;
  textSize: TextSize;
  onTextSize: (size: TextSize) => void;
}

function ChatHeader({ status, working, ended, offline, canEnd, onEnd, onClose, textSize, onTextSize }: HeaderProps) {
  return (
    <header className="shrink-0 border-b border-rule bg-sheet">
      <div className="flex items-center gap-3 px-4 pb-2.5 pt-3">
        <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-navy text-white">
          <ClosrMark className="size-[22px]" />
          {!ended && <span aria-hidden className="absolute -bottom-px -right-px size-3 rounded-full border-2 border-sheet bg-leaf" />}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight text-ink">
            Closr <span className="font-medium text-muted">· Paytm AI assistant</span>
          </h1>
          <p className={`mt-0.5 flex items-center gap-1.5 text-[12.5px] ${offline ? "font-medium text-brick" : "text-muted"}`}>
            {offline ? (
              <WifiOff aria-hidden size={12} />
            ) : working ? (
              <LoaderCircle aria-hidden size={12} className="animate-spin motion-reduce:animate-none" />
            ) : null}
            {offline ? "Reconnecting…" : status}
          </p>
        </div>
        {canEnd ? (
          <button
            type="button"
            onClick={onEnd}
            className="h-9 shrink-0 rounded-full border-[1.5px] border-rule px-3.5 text-[13px] font-semibold text-brick transition-colors hover:border-brick/40 hover:bg-brick-wash"
          >
            End chat
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border-[1.5px] border-rule pl-2.5 pr-3.5 text-[13px] font-semibold text-navy transition-colors hover:bg-sky-wash"
          >
            <X aria-hidden size={15} strokeWidth={2.5} />
            Close
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-rule/70 bg-paper px-4 py-1.5">
        <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <Lock aria-hidden size={12} className="shrink-0" />
          <span className="truncate">Paytm never asks for your UPI PIN or OTP</span>
        </p>
        <TextSizeToggle value={textSize} onChange={onTextSize} />
      </div>
    </header>
  );
}

function EndConfirm({
  ending,
  error,
  onConfirm,
  onCancel,
}: {
  ending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirm = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    confirm.current?.focus();
  }, []);
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      className="shrink-0 border-t border-rule bg-sheet px-4 pb-4 pt-3.5"
    >
      <p id={titleId} className="text-[1em] font-semibold text-ink">
        End this chat?
      </p>
      <p className="mt-0.5 text-[0.87em] leading-snug text-muted">
        You&apos;ll get a summary of everything Closr did. You can start a new chat any time.
      </p>
      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-[0.87em] font-medium text-brick">
          <CircleAlert aria-hidden className="mt-0.5 size-[1.1em] shrink-0" />
          {error}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-xl border-[1.5px] border-rule text-[0.93em] font-semibold text-ink transition-colors hover:bg-paper"
        >
          Keep chatting
        </button>
        <button
          ref={confirm}
          type="button"
          onClick={onConfirm}
          disabled={ending}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brick text-[0.93em] font-semibold text-white transition-colors hover:bg-brick/90 disabled:opacity-75"
        >
          {ending && <LoaderCircle aria-hidden size={16} className="animate-spin motion-reduce:animate-none" />}
          End chat
        </button>
      </div>
    </div>
  );
}

interface ComposerProps {
  input: RefObject<HTMLTextAreaElement | null>;
  /** Closr is answering; typing ahead is fine, sending waits. */
  busy: boolean;
  error: string | null;
  canRetry: boolean;
  onRetry: () => void;
  onSend: (text: string) => boolean;
}

function Composer({ input, busy, error, canRetry, onRetry, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const inputId = useId();
  const hintId = useId();
  const count = text.length;
  const canSend = !busy && text.trim().length > 0;

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, input]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (canSend && onSend(text)) setText("");
    input.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter while an Indian-language IME is composing picks a word; it must not send.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={submit} className="relative shrink-0 border-t border-rule bg-sheet px-3 pb-3 pt-2.5">
      {error && (
        <div role="alert" className="mb-2.5 flex items-start gap-2 rounded-xl bg-brick-wash px-3 py-2 text-[0.85em] leading-snug text-brick">
          <CircleAlert aria-hidden className="mt-0.5 size-[1.1em] shrink-0" />
          <p className="min-w-0 flex-1 font-medium">{error}</p>
          {canRetry && (
            <button
              type="button"
              onClick={() => {
                onRetry();
                input.current?.focus();
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sheet px-2.5 py-0.5 font-semibold text-brick ring-1 ring-brick/30 hover:bg-white"
            >
              <RefreshCw aria-hidden className="size-[0.95em]" strokeWidth={2.5} />
              Try again
            </button>
          )}
        </div>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor={inputId} className="sr-only">
          Message Closr
        </label>
        <div className="min-w-0 flex-1 rounded-[1.4em] border-[1.5px] border-rule bg-paper px-[0.9em] transition-colors focus-within:border-navy focus-within:bg-sheet focus-within:ring-2 focus-within:ring-sky/45">
          <textarea
            ref={input}
            id={inputId}
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type your message"
            enterKeyHint="send"
            aria-describedby={hintId}
            className="block max-h-[7.4em] w-full resize-none bg-transparent py-[0.6em] text-[1em] leading-[1.45] text-ink placeholder:text-muted focus-visible:outline-none!"
          />
        </div>
        <button
          type="submit"
          disabled={!canSend}
          className="inline-flex h-[2.8em] shrink-0 items-center gap-1.5 rounded-full bg-navy px-[1.05em] text-[0.93em] font-semibold text-white shadow-[0_8px_18px_-10px_rgb(0_46_110/0.9)] transition-[background-color,transform] hover:bg-navy-deep active:translate-y-px disabled:cursor-not-allowed disabled:bg-navy/25 disabled:shadow-none"
        >
          {busy ? (
            <LoaderCircle aria-hidden className="size-[1.15em] animate-spin motion-reduce:animate-none" />
          ) : (
            <SendHorizontal aria-hidden className="size-[1.15em]" strokeWidth={2.25} />
          )}
          Send
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[0.75em] text-muted">
        <p id={hintId}>
          {busy ? (
            "Closr is replying. You can keep typing."
          ) : (
            <>
              <span className="sr-only">Press Enter to send and Shift plus Enter for a new line. Up to 500 characters.</span>
              <span aria-hidden className="hidden md:inline">
                Enter to send · Shift + Enter for a new line
              </span>
              <span aria-hidden className="md:hidden">
                Up to {MAX_MESSAGE_LENGTH} characters
              </span>
            </>
          )}
        </p>
        {count >= COUNTER_FROM && (
          <p className={`figures shrink-0 ${count >= MAX_MESSAGE_LENGTH ? "font-semibold text-brick" : ""}`}>
            {count}/{MAX_MESSAGE_LENGTH}
            {count >= MAX_MESSAGE_LENGTH && " · limit reached"}
          </p>
        )}
      </div>
    </form>
  );
}

interface Props {
  chat: Chat;
  /** Only this customer's records, so the cards can name their payments and devices. */
  records: CallerRecords;
  offline: boolean;
}

/** Closr in the Paytm app, typed instead of spoken: each action it takes shows up as a card between the messages. */
export function ChatScreen({ chat, records, offline }: Props) {
  const { phase, session, pending } = chat;
  const profile = chat.profile ?? records.kind;
  const [textSize, setTextSize] = useTextSize();
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const resolution = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const reduceMotion = useReducedMotion();
  const chipsLabel = useId();

  const kept = session?.moments;
  const moments = useMemo(() => chronological(Object.values(kept ?? {})), [kept]);
  const steps = useMemo(() => customerFeed(moments, records), [moments, records]);
  const entries = useMemo(() => (session ? chatTimeline(session, steps) : []), [session, steps]);
  const ended = phase === "ended";
  const startFailed = phase === "starting" && chat.error !== null;
  const working = !startFailed && pending !== null;
  const line = workingLine(phase, stepsForTurn(session, steps, pending));
  const summary = useMemo(() => (ended ? summarizeCall(moments, records) : null), [ended, moments, records]);

  const customerSpoke = session?.messages.some((m) => m.from === "customer") ?? false;
  const suggestions = session?.suggestions.length ? session.suggestions : customerSpoke ? [] : FALLBACK_SUGGESTIONS[profile];
  const showSuggestions = phase === "open" && !pending && suggestions.length > 0;
  const canRetry = phase === "open" && !pending && (session?.messages.some((m) => m.failed) ?? false);

  const status = ended ? "Chat ended" : startFailed ? "Couldn't connect" : working ? "Working on it…" : "Replies in seconds";

  const last = entries.at(-1);
  const lastKey = [
    entries.length,
    last?.type === "step" ? `${last.step.id}:${last.step.tone}:${last.confirmations.length}` : last?.message.id,
    pending,
    showSuggestions,
    textSize,
  ].join("|");

  useEffect(() => {
    const el = scroller.current;
    if (!el || ended || !stick.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [lastKey, ended, reduceMotion]);

  useEffect(() => {
    if (ended) resolution.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  }, [ended, reduceMotion]);

  // The control that opened the composer (the entry button, "Start a new chat", "Try again") is gone by now.
  const composerShown = (phase === "starting" || phase === "open") && !startFailed;
  useEffect(() => {
    if (composerShown) input.current?.focus();
  }, [composerShown]);

  useEffect(() => {
    if (ended) setConfirmingEnd(false);
  }, [ended]);

  const send = (text: string) => {
    const sent = chat.send(text);
    if (sent) stick.current = true;
    return sent;
  };

  const cancelEnd = () => {
    setConfirmingEnd(false);
    requestAnimationFrame(() => input.current?.focus());
  };

  const confirmEnd = () => {
    void chat.end();
  };

  return (
    <section aria-label="Chat with Closr" className="flex min-h-0 flex-1 flex-col bg-paper">
      <ChatHeader
        status={status}
        working={working}
        ended={ended}
        offline={offline}
        canEnd={phase === "open"}
        onEnd={() => setConfirmingEnd(true)}
        onClose={chat.close}
        textSize={textSize}
        onTextSize={setTextSize}
      />

      <div className={`flex min-h-0 flex-1 flex-col ${FONT_SIZE[textSize]}`}>
        <div
          ref={scroller}
          tabIndex={0}
          aria-label="Conversation"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
          }}
          className="scrollbar-quiet relative min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-offset-[-2px]"
        >
          <div className="px-4 pt-4 text-center">
            <p className="figures inline-block rounded-full bg-sheet px-2.5 py-0.5 text-[0.75em] font-medium text-muted ring-1 ring-rule">
              Today{session && ` · ${timeOfDay(session.startedAt)}`}
            </p>
            <p className="mx-auto mt-2 max-w-[32ch] text-[0.78em] leading-snug text-muted">
              You&apos;re signed in, so Closr can already see your account. Each step it takes shows up here.
            </p>
          </div>

          <div
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Messages with Closr"
            className="space-y-3 px-4 pb-3 pt-4 [overflow-wrap:anywhere]"
          >
            {entries.map((entry) =>
              entry.type === "message" ? (
                <motion.div
                  key={entry.message.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <Bubble message={entry.message} />
                </motion.div>
              ) : (
                <motion.div
                  key={entry.step.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                  className="pl-9"
                >
                  <ChatCard step={entry.step} confirmations={entry.confirmations} />
                </motion.div>
              ),
            )}
            {ended && session?.endedAt && (
              <p className="figures pt-2 text-center text-[0.75em] font-medium text-muted">
                Chat ended · {timeOfDay(session.endedAt)}
              </p>
            )}
          </div>

          <p role="status" className="sr-only">
            {working ? (phase === "starting" ? "Connecting you to Closr" : "Closr is working on your message") : ""}
          </p>
          {working && (
            <div className="px-4 pb-3">
              <Working line={line} />
            </div>
          )}

          {startFailed && (
            <div role="alert" className="card mx-4 mb-4 px-5 py-5 text-center">
              <CircleAlert aria-hidden size={22} className="mx-auto text-brick" />
              <p className="mt-2 text-[1em] font-semibold text-ink">Couldn&apos;t start the chat</p>
              <p className="mt-1 text-[0.87em] leading-snug text-muted">{chat.error}</p>
              <button
                type="button"
                onClick={() => chat.start(profile)}
                className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-navy px-5 text-[0.93em] font-semibold text-white hover:bg-navy-deep"
              >
                <RefreshCw aria-hidden size={16} strokeWidth={2.25} />
                Try again
              </button>
            </div>
          )}

          {showSuggestions && (
            <div className="px-4 pb-4">
              <p id={chipsLabel} className="mb-2 text-right text-[0.75em] font-medium text-muted">
                Suggested replies
              </p>
              <ul aria-labelledby={chipsLabel} className="flex flex-wrap justify-end gap-2">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => {
                        send(s);
                        input.current?.focus();
                      }}
                      className="rounded-full border-[1.5px] border-navy/25 bg-sheet px-[0.95em] py-[0.45em] text-left text-[0.87em] font-semibold leading-snug text-navy transition-colors hover:border-navy hover:bg-sky-wash"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ended && session && summary && (
            <div ref={resolution} className="scroll-mt-2">
              <CallResolution
                call={{
                  callRef: session.sessionRef,
                  channel: "chat",
                  status: "completed",
                  startedAt: session.startedAt,
                  endedAt: session.endedAt,
                  durationSec: session.durationSec,
                }}
                elapsed={session.endedAt ? Date.parse(session.endedAt) - Date.parse(session.startedAt) : null}
                {...summary}
                onRequestAgain={() => chat.start(profile)}
                focusOnMount
              />
            </div>
          )}
        </div>

        {composerShown &&
          (confirmingEnd ? (
            <EndConfirm ending={chat.ending} error={chat.error} onConfirm={confirmEnd} onCancel={cancelEnd} />
          ) : (
            <Composer
              input={input}
              busy={pending !== null}
              error={chat.error}
              canRetry={canRetry}
              onRetry={chat.retry}
              onSend={send}
            />
          ))}
      </div>
    </section>
  );
}
