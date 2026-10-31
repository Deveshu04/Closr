"use client";

import {
  AudioLines,
  CircleAlert,
  Gauge,
  Info,
  LoaderCircle,
  type LucideIcon,
  MapPin,
  Phone,
  PhoneCall,
  PhoneOff,
  PhoneOutgoing,
} from "lucide-react";
import { useId } from "react";
import type { CallRecord, Customer } from "@/lib/types";
import { type CallPhase, useCallRequest } from "./hooks/useCallRequest";
import { duration, humanize, inr } from "./lib/format";
import { displayIndianMobile } from "./lib/phone";

const STATUS: Record<CallPhase, { label: string; icon: LucideIcon; tone: string }> = {
  idle: { label: "Ready to call", icon: Phone, tone: "text-white/65" },
  dialing: { label: "Dialing", icon: PhoneOutgoing, tone: "text-sky" },
  ringing: { label: "Ringing", icon: PhoneCall, tone: "text-sky" },
  in_progress: { label: "In progress", icon: AudioLines, tone: "text-sky" },
  completed: { label: "Completed", icon: PhoneOff, tone: "text-white/75" },
  failed: { label: "Failed", icon: PhoneOff, tone: "text-[#ffb3a7]" },
};

const TIER: Record<Customer["tier"], { label: string; className: string }> = {
  vip: { label: "VIP", className: "bg-sky text-navy" },
  regular: { label: "Regular", className: "border border-white/30 text-white" },
  new: { label: "New customer", className: "border border-white/30 text-white" },
};

interface Props {
  call: CallRecord | null;
  customer: Customer | undefined;
  /** Set while the caller's CRM record is being touched, to flash the caller block. */
  customerPulse: number | undefined;
  refresh: () => void;
  className?: string;
}

const SECTION =
  "py-5 first:pt-0 last:pb-0 lg:px-6 lg:py-1 lg:first:pl-0 lg:last:pr-0 xl:px-0 xl:py-5 xl:first:pt-0 xl:last:pb-0";

export function CallPanel({ call, customer, customerPulse, refresh, className = "" }: Props) {
  const inputId = useId();
  const hintId = useId();
  const request = useCallRequest(call, refresh);
  const { phone, showInvalid, starting, error, stale, busy, live, elapsed, phase: status } = request;

  const meta = STATUS[status];
  const StatusIcon = meta.icon;

  return (
    <aside
      aria-label="Call"
      className={`flex flex-col divide-y divide-white/10 bg-navy px-5 py-6 text-white sm:px-6 lg:flex-row lg:items-start lg:divide-x lg:divide-y-0 lg:py-5 xl:flex-col xl:items-stretch xl:divide-x-0 xl:divide-y xl:overflow-y-auto xl:py-6 [scrollbar-color:rgb(255_255_255/0.18)_transparent] [scrollbar-width:thin] ${className}`}
    >
      <form onSubmit={request.submit} noValidate className={`${SECTION} lg:w-[23rem] lg:shrink-0 xl:w-auto`}>
        <label htmlFor={inputId} className="text-[15px] font-medium text-white/85">
          Customer&apos;s mobile number
        </label>
        <input
          id={inputId}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="98765 43210"
          value={request.phoneInput}
          onChange={(e) => request.setPhoneInput(e.target.value)}
          onBlur={request.onPhoneBlur}
          aria-invalid={showInvalid}
          aria-describedby={hintId}
          className={`figures mt-2 h-12 w-full rounded-md border bg-white/[0.07] px-3.5 text-lg tracking-wide text-white placeholder:text-white/30 focus:outline-none focus-visible:outline-none ${
            showInvalid ? "border-[#ffb3a7]" : "border-white/20 focus:border-sky"
          }`}
        />
        <p id={hintId} className={`mt-1.5 min-h-5 text-sm ${showInvalid ? "text-[#ffb3a7]" : "text-white/60"}`}>
          {showInvalid
            ? "Enter a 10-digit Indian mobile number, like 98765 43210."
            : phone
              ? `Closr will call ${displayIndianMobile(phone)}`
              : "10 digits, with or without +91."}
        </p>

        <button
          type="submit"
          disabled={busy || !phone}
          className="mt-3 inline-flex h-16 w-full items-center justify-center gap-3 rounded-lg bg-sky text-xl font-semibold lg:h-13 xl:h-16 text-navy shadow-[0_10px_24px_-12px_rgb(0_186_242/0.8)] transition-[background-color,transform] hover:bg-[#3fcbf6] active:translate-y-px disabled:cursor-not-allowed disabled:bg-white/12 disabled:text-white/45 disabled:shadow-none"
        >
          {starting ? (
            <LoaderCircle aria-hidden size={24} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <PhoneCall aria-hidden size={24} strokeWidth={2.25} />
          )}
          {starting ? "Calling…" : "Call customer"}
        </button>

        {error && (
          <p role="alert" className="mt-2.5 flex items-start gap-2 text-[15px] font-medium leading-snug text-[#ffb3a7]">
            <CircleAlert aria-hidden size={18} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        {stale && (
          <p className="mt-2.5 text-sm text-white/60">
            The last call never reported an end. You can start a new one.
          </p>
        )}
        {status === "idle" && !error && (
          <p className="mt-3 text-[15px] leading-snug text-white/75">
            Their phone rings in a few seconds. Closr handles the call; every step it takes shows up here.
          </p>
        )}
        <p className="mt-3 flex items-start gap-2 text-[13px] leading-snug text-white/50">
          <Info aria-hidden size={14} className="mt-0.5 shrink-0" />
          Prototype: calls only reach numbers verified on our Bolna developer account.
        </p>
      </form>

      <section aria-label="Call status" className={`${SECTION} lg:w-48 lg:shrink-0 xl:w-auto`}>
        <p aria-live="polite" className={`flex items-center gap-2.5 text-[15px] font-semibold ${meta.tone}`}>
          {live ? (
            <span className="live-dot size-2.5 shrink-0 rounded-full bg-sky" aria-hidden />
          ) : (
            <StatusIcon aria-hidden size={17} strokeWidth={2.25} />
          )}
          {meta.label}
        </p>
        <p
          className={`figures mt-1.5 text-[2.75rem] font-semibold leading-none tracking-tight ${
            elapsed === null ? "text-white/25" : "text-white"
          }`}
        >
          {duration(elapsed ?? 0)}
        </p>
      </section>

      <section aria-label="Caller" className={`${SECTION} lg:min-w-0 lg:flex-1`}>
        <p className="text-[13px] text-white/55">Caller</p>
        {customer ? (
          <div key={customerPulse ?? 0} className={`-mx-2 mt-1 rounded-md px-2 py-1 ${customerPulse ? "block-touched" : ""}`}>
            <p className="font-serif text-[1.625rem] font-semibold leading-tight [font-variation-settings:'opsz'_40]">
              {customer.name}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[15px] text-white/80">
              <span className={`rounded px-2 py-0.5 text-[13px] font-semibold ${TIER[customer.tier]?.className ?? TIER.regular.className}`}>
                {TIER[customer.tier]?.label ?? humanize(String(customer.tier))}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin aria-hidden size={14} className="text-white/60" />
                {customer.city}
              </span>
              {customer.language && <span>Speaks {humanize(customer.language)}</span>}
            </div>
            {Number.isFinite(customer.lifetimeValue) && (
              <p className="figures mt-1.5 text-sm text-white/60">{inr(customer.lifetimeValue)} spent with us</p>
            )}
            {customer.flags?.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {customer.flags.map((f) => (
                  <li key={f} className="rounded border border-white/20 px-1.5 py-0.5 text-xs text-white/75">
                    {humanize(f)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-1 text-[15px] leading-snug text-white/55">
            {live ? "Identifying the caller…" : "Name, tier and city appear once Closr knows who is calling."}
          </p>
        )}
        {call?.summary && status === "completed" && (
          <div className="mt-4 lg:hidden xl:block">
            <p className="text-[13px] text-white/55">Call summary</p>
            <p className="mt-1 font-serif text-base italic leading-relaxed text-white/85">{call.summary}</p>
          </div>
        )}
      </section>

      <section aria-label="Trust level" className={`${SECTION} lg:w-64 lg:shrink-0 xl:w-auto`}>
        <span className="inline-flex items-center gap-2 rounded-full border border-sky/50 bg-sky/10 px-3 py-1 text-sm font-semibold">
          <Gauge aria-hidden size={15} className="text-sky" />
          L2 · Auto within limits
        </span>
        <p className="mt-2 text-sm leading-snug text-white/60">
          Closr acts on its own inside policy limits. Anything above them comes to you for approval.
        </p>
      </section>
    </aside>
  );
}
