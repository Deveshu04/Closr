"use client";

import { AnimatePresence, useReducedMotion } from "motion/react";
import { type CSSProperties, useEffect, useRef } from "react";
import type { CallRecord, Customer, Moment, MomentKind } from "@/lib/types";
import { TranscriptButton } from "./backoffice/CallHistory";
import { ChannelBadge } from "./ChannelBadge";
import type { ApprovalControls } from "./hooks/useApprovals";
import { type Channel, channelOf } from "./lib/records";
import { MomentRow, SPINE_LEFT } from "./moments/MomentRow";
import { KIND_META } from "./moments/shared";

const STICK_THRESHOLD_PX = 140;
const LEGEND: MomentKind[] = ["understood", "lookup", "policy", "action", "verified", "approval", "search", "escalated"];
const ACTIVE = new Set<CallRecord["status"]>(["dialing", "ringing", "in_progress"]);

interface Props {
  moments: Moment[];
  call: CallRecord | null;
  /** The customer on the call shown, once Closr has identified them. */
  customer: Customer | undefined;
  controls: ApprovalControls;
  className?: string;
}

function offsetBase(moments: Moment[], call: CallRecord | null): number {
  const fromCall = call ? Date.parse(call.startedAt) : NaN;
  if (Number.isFinite(fromCall)) return fromCall;
  const first = moments[0] ? Date.parse(moments[0].at) : NaN;
  return Number.isFinite(first) ? first : 0;
}

export function MomentsTimeline({ moments, call, customer, controls, className = "" }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const reduceMotion = useReducedMotion();
  const live = call ? ACTIVE.has(call.status) : false;
  const ended = call?.status === "completed" || call?.status === "failed";
  const base = offsetBase(moments, call);
  const last = moments.at(-1);
  const lastKey = last ? `${moments.length}:${last.id}:${last.status}` : "";
  const actions = moments.filter((m) => m.kind === "action" && m.status === "ok").length;
  const steps = moments.filter((m) => m.kind !== "call").length;
  const channel = channelOf(call);
  const noun = channel === "chat" ? "chat" : "call";

  useEffect(() => {
    const el = scroller.current;
    if (!el || !lastKey || !stick.current) return;
    if (el.scrollHeight <= el.clientHeight) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [lastKey, reduceMotion]);

  return (
    <section aria-labelledby="timeline-heading" className={`flex flex-col bg-paper lg:min-h-0 ${className}`}>
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-5 pb-3 pt-5 lg:px-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="timeline-heading" className="font-serif text-[1.625rem] font-semibold leading-tight text-navy">
              {live || moments.length === 0 ? (channel === "chat" ? "In this chat" : "On this call") : `Last ${noun}`}
            </h2>
            {call && <ChannelBadge channel={channel} />}
          </div>
          {customer && moments.length > 0 && (
            <p className="mt-0.5 truncate text-[14px] text-muted">
              {customer.kind === "merchant" ? (customer.business?.name ?? customer.name) : customer.name}
              <span className="text-faint"> · {customer.kind === "merchant" ? "Merchant" : "Consumer"}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {steps > 0 && (
            <p className="figures text-[14px] text-muted">
              {steps} {steps === 1 ? "step" : "steps"}
              {actions > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-navy">
                    {actions} {actions === 1 ? "action" : "actions"} in the back office
                  </span>
                </>
              )}
            </p>
          )}
          {ended && call && <TranscriptButton variant="button" call={{ callRef: call.callRef, hasTranscript: Boolean(call.transcript) }} />}
        </div>
        {ended && call?.summary && (
          <p className="w-full max-w-[64ch] border-l-2 border-sky/60 pl-3 font-serif text-[15.5px] italic leading-relaxed text-ink/85">
            {call.summary}
          </p>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
        }}
        className="scrollbar-quiet px-3 pb-8 sm:px-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-8"
      >
        {moments.length > 0 ? (
          <ol
            aria-live="polite"
            aria-relevant="additions"
            className="relative pt-2 [overflow-wrap:anywhere] before:absolute before:bottom-6 before:left-(--spine) before:top-4 before:w-px before:bg-rule before:content-['']"
            style={{ "--spine": SPINE_LEFT } as CSSProperties}
          >
            <AnimatePresence initial={false}>
              {moments.map((m, i) => (
                <MomentRow
                  key={m.id}
                  moment={m}
                  offsetMs={Math.max(0, Date.parse(m.at) - base) || 0}
                  latest={live && i === moments.length - 1}
                  controls={controls}
                />
              ))}
            </AnimatePresence>
          </ol>
        ) : (
          <EmptyTimeline waiting={live} channel={channel} />
        )}
      </div>
    </section>
  );
}

function EmptyTimeline({ waiting, channel }: { waiting: boolean; channel: Channel }) {
  return (
    <div className="max-w-[40rem] pt-2">
      <p className="font-serif text-[1.75rem] leading-snug text-navy [font-variation-settings:'opsz'_40] sm:text-[2rem]">
        {!waiting
          ? "Every step Closr takes on a call or chat lands here, the moment it takes it."
          : channel === "chat"
            ? "The customer is chatting with Closr in the Paytm app. Each step it takes will appear here as it happens."
            : "Closr is calling the customer. Each step it takes will appear here as it happens."}
      </p>
      <p className="mt-3 max-w-[56ch] text-base leading-relaxed text-muted">
        It listens, pulls the records, checks policy, acts, then re-reads the system to confirm. Rules a customer cites
        are checked against RBI and NPCI sources, and anything over its limit comes to a person as a one-tap approval.
      </p>

      <ul aria-label="Kinds of steps" className="relative mt-8 space-y-4 before:absolute before:bottom-4 before:left-4 before:top-4 before:w-px before:bg-rule before:content-['']">
        {LEGEND.map((kind) => {
          const { icon: Icon, label, hint } = KIND_META[kind];
          return (
            <li key={kind} className="relative flex items-center gap-4">
              <span className="relative grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] border-navy/20 bg-paper text-navy/70">
                <Icon aria-hidden size={16} strokeWidth={2.25} />
              </span>
              <p className="text-[15px] leading-snug">
                <span className="font-semibold text-ink">{label}</span>{" "}
                <span className="text-muted">{hint}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
