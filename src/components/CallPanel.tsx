"use client";

import {
  AudioLines,
  CircleAlert,
  Info,
  Landmark,
  LoaderCircle,
  Lock,
  type LucideIcon,
  MapPin,
  MessageSquareText,
  Phone,
  PhoneCall,
  PhoneOff,
  PhoneOutgoing,
  Store,
  UserRound,
} from "lucide-react";
import { useId } from "react";
import type { AutonomyLevel, CallRecord, Customer, ProfileKind, Workflow } from "@/lib/types";
import { ChannelBadge } from "./ChannelBadge";
import { type CallPhase, useCallRequest } from "./hooks/useCallRequest";
import { duration, humanize, lastFour } from "./lib/format";
import { displayIndianMobile } from "./lib/phone";
import { type Channel, PROFILE_LABEL, channelOf, firstName } from "./lib/records";
import { TrustDial } from "./TrustDial";

type StatusMeta = { label: string; icon: LucideIcon; tone: string };

const STATUS: Record<CallPhase, StatusMeta> = {
  idle: { label: "Ready to call", icon: Phone, tone: "text-white/65" },
  dialing: { label: "Dialing", icon: PhoneOutgoing, tone: "text-sky" },
  ringing: { label: "Ringing", icon: PhoneCall, tone: "text-sky" },
  in_progress: { label: "In progress", icon: AudioLines, tone: "text-sky" },
  completed: { label: "Completed", icon: PhoneOff, tone: "text-white/75" },
  failed: { label: "Failed", icon: PhoneOff, tone: "text-[#ffb3a7]" },
};

/** A chat never rings and has no talk time; it's typed in the customer's Paytm app. */
const CHAT_STATUS: Partial<Record<CallPhase, StatusMeta>> = {
  dialing: { label: "Opening chat", icon: MessageSquareText, tone: "text-sky" },
  ringing: { label: "Opening chat", icon: MessageSquareText, tone: "text-sky" },
  in_progress: { label: "Chat in progress", icon: MessageSquareText, tone: "text-sky" },
  completed: { label: "Chat ended", icon: MessageSquareText, tone: "text-white/75" },
  failed: { label: "Chat failed", icon: MessageSquareText, tone: "text-[#ffb3a7]" },
};

const PROFILE_ICON: Record<ProfileKind, LucideIcon> = { consumer: UserRound, merchant: Store };
const FALLBACK_NAME: Record<ProfileKind, string> = { consumer: "Deveshu", merchant: "Rakesh Kirana Store" };

export interface ProfileOption {
  kind: ProfileKind;
  customer: Customer | undefined;
}

interface Props {
  call: CallRecord | null;
  profile: ProfileKind;
  onProfile: (kind: ProfileKind) => void;
  options: ProfileOption[];
  /** Who the console is showing: the live caller, else the demo customer for the chosen profile. */
  customer: Customer | undefined;
  customerRole: "live" | "last" | "demo";
  /** Set while the caller's CRM record is being touched, to flash the caller block. */
  customerPulse: number | undefined;
  autonomy: Record<Workflow, AutonomyLevel>;
  refresh: () => void;
  className?: string;
}

const SECTION =
  "py-5 first:pt-0 last:pb-0 lg:px-6 lg:py-1 lg:first:pl-0 lg:last:pr-0 xl:px-0 xl:py-4 xl:first:pt-0 xl:last:pb-0";

function optionName(option: ProfileOption): string {
  const c = option.customer;
  if (!c) return FALLBACK_NAME[option.kind];
  return option.kind === "merchant" ? (c.business?.name ?? c.name) : firstName(c.name);
}

function ProfileSwitch({
  value,
  options,
  locked,
  onChange,
}: {
  value: ProfileKind;
  options: ProfileOption[];
  locked: boolean;
  onChange: (kind: ProfileKind) => void;
}) {
  const name = useId();
  return (
    <fieldset disabled={locked} className="min-w-0">
      <legend className="flex w-full items-center justify-between gap-2 text-[13px] font-medium text-white/60">
        Call back for
        {locked && (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-normal text-white/45">
            <Lock aria-hidden size={11} />
            Locked to this call
          </span>
        )}
      </legend>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.06] p-1 ring-1 ring-white/10">
        {options.map((option) => {
          const selected = option.kind === value;
          const Icon = PROFILE_ICON[option.kind];
          const label = optionName(option);
          return (
            <label
              key={option.kind}
              title={`${PROFILE_LABEL[option.kind]} · ${label}`}
              className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-sky ${
                selected
                  ? "bg-white text-navy shadow-[0_6px_16px_-10px_rgb(0_0_0/0.6)]"
                  : `text-white/70 ${locked ? "opacity-50" : "cursor-pointer hover:bg-white/[0.07] hover:text-white"}`
              } ${locked ? "cursor-not-allowed" : ""}`}
            >
              <input
                type="radio"
                name={name}
                value={option.kind}
                checked={selected}
                onChange={() => onChange(option.kind)}
                className="sr-only"
              />
              <Icon aria-hidden size={16} strokeWidth={2.25} className={`shrink-0 ${selected ? "text-sky" : ""}`} />
              <span className="min-w-0 leading-tight">
                <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] opacity-65">
                  {PROFILE_LABEL[option.kind]}
                </span>
                <span className="block truncate text-[13.5px] font-semibold">{label}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Detail({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-white/50">{label}</dt>
      <dd title={title} className="figures truncate text-[14px] font-medium text-white/90">
        {value}
      </dd>
    </div>
  );
}

function CallerCard({ customer }: { customer: Customer }) {
  const merchant = customer.kind === "merchant" && customer.business;
  const bank = `${customer.bank.bank} ${lastFour(customer.bank.last4)}`;
  return (
    <>
      <p className="font-serif text-[1.625rem] font-semibold leading-tight [font-variation-settings:'opsz'_40]">
        {merchant ? customer.business?.name : customer.name}
      </p>
      {merchant && <p className="mt-0.5 text-[14px] text-white/70">{customer.name} · Owner</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14px] text-white/80">
        <span
          className={`rounded px-2 py-0.5 text-[12.5px] font-semibold ${
            customer.kyc === "full" ? "bg-sky text-navy" : "border border-white/30 text-white"
          }`}
        >
          {customer.kyc === "full" ? "Full KYC" : "Min KYC"}
        </span>
        <span className="inline-flex items-center gap-1">
          <MapPin aria-hidden size={14} className="text-white/55" />
          {customer.city}
        </span>
        {customer.language && <span>Speaks {humanize(customer.language)}</span>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {merchant && customer.business ? (
          <>
            <Detail label="MID" value={lastFour(customer.business.mid)} title={`MID ${customer.business.mid}`} />
            <Detail label="Category" value={customer.business.category} />
            <Detail label="Settles to" value={bank} title={`${customer.bank.bank} account ending ${customer.bank.last4}, IFSC ${customer.bank.ifsc}`} />
            <Detail label="On Paytm since" value={customer.since.slice(0, 4)} />
          </>
        ) : (
          <>
            <Detail label="UPI ID" value={customer.upiHandle} title={customer.upiHandle} />
            <Detail label="Linked bank" value={bank} title={`${customer.bank.bank} account ending ${customer.bank.last4}, IFSC ${customer.bank.ifsc}`} />
            <Detail label="On Paytm since" value={customer.since.slice(0, 4)} />
          </>
        )}
      </dl>
      {customer.bank.status !== "active" && (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#ffb3a7]">
          <Landmark aria-hidden size={14} />
          Bank account {customer.bank.status}
        </p>
      )}
      {customer.flags?.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {customer.flags.map((f) => (
            <li key={f} className="rounded border border-white/20 px-1.5 py-0.5 text-xs text-white/75">
              {humanize(f)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const ROLE_LABEL: Record<Channel, Record<Props["customerRole"], string>> = {
  voice: { live: "On the call", last: "Last call", demo: "Calling for" },
  chat: { live: "In the chat", last: "Last chat", demo: "Calling for" },
};

export function CallPanel({
  call,
  profile,
  onProfile,
  options,
  customer,
  customerRole,
  customerPulse,
  autonomy,
  refresh,
  className = "",
}: Props) {
  const inputId = useId();
  const hintId = useId();
  const request = useCallRequest(call, refresh, profile);
  const { phone, showInvalid, starting, error, stale, busy, live, elapsed, phase: status } = request;
  // While a new call is being placed, `call` is still the previous session, which may have been a chat.
  const channel: Channel = request.pending ? "voice" : channelOf(call);

  const meta = (channel === "chat" ? CHAT_STATUS[status] : undefined) ?? STATUS[status];
  const StatusIcon = meta.icon;

  return (
    <aside
      aria-label="Call"
      className={`flex flex-col divide-y divide-white/10 bg-navy px-5 py-6 text-white sm:px-6 lg:flex-row lg:items-start lg:divide-x lg:divide-y-0 lg:py-5 xl:flex-col xl:items-stretch xl:divide-x-0 xl:divide-y xl:overflow-y-auto xl:py-4 [scrollbar-color:rgb(255_255_255/0.18)_transparent] [scrollbar-width:thin] ${className}`}
    >
      <form onSubmit={request.submit} noValidate className={`${SECTION} lg:w-[23rem] lg:shrink-0 xl:w-auto`}>
        <ProfileSwitch value={profile} options={options} locked={busy} onChange={onProfile} />

        <label htmlFor={inputId} className="mt-3.5 block text-[13px] font-medium text-white/60">
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
        <p id={hintId} className={`mt-1.5 min-h-5 text-[13px] ${showInvalid ? "text-[#ffb3a7]" : "text-white/55"}`}>
          {showInvalid
            ? "Enter a 10-digit Indian mobile number, like 98765 43210."
            : phone
              ? `Closr will call ${displayIndianMobile(phone)}`
              : "10 digits, with or without +91."}
        </p>

        <button
          type="submit"
          disabled={busy || !phone}
          className="mt-2.5 inline-flex h-14 w-full items-center justify-center gap-3 rounded-lg bg-sky text-lg font-semibold text-navy shadow-[0_10px_24px_-12px_rgb(0_186_242/0.8)] transition-[background-color,transform] hover:bg-[#3fcbf6] active:translate-y-px disabled:cursor-not-allowed disabled:bg-white/12 disabled:text-white/45 disabled:shadow-none lg:h-12"
        >
          {starting ? (
            <LoaderCircle aria-hidden size={22} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <PhoneCall aria-hidden size={22} strokeWidth={2.25} />
          )}
          {starting ? "Calling…" : "Call customer"}
        </button>

        {error && (
          <p role="alert" className="mt-2.5 flex items-start gap-2 text-[14px] font-medium leading-snug text-[#ffb3a7]">
            <CircleAlert aria-hidden size={17} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        {stale && (
          <p className="mt-2.5 text-[13px] text-white/60">The last call never reported an end. You can start a new one.</p>
        )}
        <p
          title="Calls only reach numbers verified on our Bolna developer account."
          className="mt-2.5 flex items-center gap-1.5 text-[12.5px] leading-snug text-white/45"
        >
          <Info aria-hidden size={13} className="shrink-0" />
          Prototype: verified numbers only
        </p>
      </form>

      <section aria-label={channel === "chat" ? "Chat status" : "Call status"} className={`${SECTION} lg:w-52 lg:shrink-0 xl:w-auto`}>
        {call && (
          <div className="mb-2">
            <ChannelBadge channel={channel} tone="dark" />
          </div>
        )}
        <div className="flex items-center justify-between gap-3 lg:block xl:flex">
          <p aria-live="polite" className={`flex items-center gap-2.5 text-[14px] font-semibold ${meta.tone}`}>
            {live ? (
              <span className="live-dot size-2.5 shrink-0 rounded-full bg-sky" aria-hidden />
            ) : (
              <StatusIcon aria-hidden size={16} strokeWidth={2.25} />
            )}
            {meta.label}
          </p>
          <p
            aria-label={channel === "chat" ? "Chat time" : "Call time"}
            className={`figures text-[2rem] font-semibold leading-none tracking-tight lg:mt-1.5 xl:mt-0 ${
              elapsed === null ? "text-white/25" : "text-white"
            }`}
          >
            {duration(call?.durationSec !== undefined && !live ? call.durationSec * 1000 : (elapsed ?? 0))}
          </p>
        </div>
      </section>

      <section aria-label="Customer" className={`${SECTION} lg:min-w-0 lg:flex-1`}>
        <p className="text-[13px] text-white/55">{ROLE_LABEL[channel][customerRole]}</p>
        {customer ? (
          <div key={customerPulse ?? 0} className={`-mx-2 mt-1 rounded-md px-2 py-1 ${customerPulse ? "block-touched" : ""}`}>
            <CallerCard customer={customer} />
          </div>
        ) : (
          <p className="mt-1 text-[14px] leading-snug text-white/55">
            {live ? "Identifying the caller…" : "Customer details appear once the demo data loads."}
          </p>
        )}
      </section>

      <section aria-label="Trust level" className={`${SECTION} lg:w-64 lg:shrink-0 xl:w-auto`}>
        <TrustDial autonomy={autonomy} refresh={refresh} />
      </section>
    </aside>
  );
}
