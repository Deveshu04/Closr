"use client";

import {
  ArrowLeftRight,
  CircleAlert,
  Gift,
  HandCoins,
  Headset,
  Info,
  Landmark,
  LoaderCircle,
  type LucideIcon,
  PhoneCall,
  PhoneMissed,
  Receipt,
  ShieldCheck,
  Speaker,
} from "lucide-react";
import { useId } from "react";
import type { ProfileKind } from "@/lib/types";
import type { CallRequest } from "../hooks/useCallRequest";
import { displayIndianMobile, withoutCountryCode } from "../lib/phone";

const COPY: Record<ProfileKind, { title: string; pitch: string; canFix: { icon: LucideIcon; label: string }[] }> = {
  consumer: {
    title: "Get help on a call",
    pitch: "Closr, our AI assistant, calls you back in seconds and can fix most payment issues right on the call.",
    canFix: [
      { icon: ArrowLeftRight, label: "Stuck UPI payments" },
      { icon: Gift, label: "Cashback" },
      { icon: HandCoins, label: "Loan EMIs" },
    ],
  },
  merchant: {
    title: "Business help on a call",
    pitch: "Closr calls you back in seconds and can fix most Soundbox, settlement and billing issues on the call.",
    canFix: [
      { icon: Speaker, label: "Soundbox" },
      { icon: Landmark, label: "Settlements" },
      { icon: Receipt, label: "Rental charges" },
    ],
  },
};

const HOW_IT_WORKS = [
  "We call you back in a few seconds",
  "Tell Closr what went wrong, in Hindi, English or Hinglish",
  "Watch each fix appear here as it happens",
];

interface Props {
  app: ProfileKind;
  /** The signed-in user's first name, for the greeting. */
  firstName: string | undefined;
  request: CallRequest;
  /** The last call never connected, so say so before asking again. */
  lastCallMissed: boolean;
}

export function RequestCallBack({ app, firstName, request, lastCallMissed }: Props) {
  const copy = COPY[app];
  const inputId = useId();
  const hintId = useId();
  const { phone, showInvalid, starting, busy, error } = request;

  return (
    <div className="space-y-4 p-4">
      <section className="relative overflow-hidden rounded-2xl bg-navy px-5 pb-5 pt-6 text-white shadow-[0_18px_36px_-20px_rgb(0_46_110/0.9)]">
        <span aria-hidden className="absolute -right-10 -top-12 size-40 rounded-full border-[18px] border-sky/20" />
        <span className="relative grid size-11 place-items-center rounded-full bg-sky text-navy">
          <Headset aria-hidden size={22} strokeWidth={2.25} />
        </span>
        {firstName && <p className="relative mt-4 text-[14px] font-medium text-sky">Hi {firstName},</p>}
        <h2 className={`relative text-[1.5rem] font-bold leading-tight tracking-[-0.01em] ${firstName ? "mt-0.5" : "mt-4"}`}>
          {copy.title}
        </h2>
        <p className="relative mt-2 text-[15px] leading-relaxed text-white/80">{copy.pitch}</p>
        <ul aria-label="Closr can help with" className="relative mt-4 flex flex-wrap gap-2">
          {copy.canFix.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[13px] font-medium text-white/90"
            >
              <Icon aria-hidden size={14} className="text-sky" />
              {label}
            </li>
          ))}
        </ul>
      </section>

      <form onSubmit={request.submit} noValidate className="card p-5">
        {lastCallMissed && !error && (
          <p className="mb-4 flex items-start gap-2.5 rounded-xl bg-amber-wash px-3 py-2.5 text-sm leading-snug text-ink">
            <PhoneMissed aria-hidden size={16} className="mt-0.5 shrink-0 text-amber" />
            We couldn&apos;t reach you on the last call. Check your number and try again.
          </p>
        )}
        <label htmlFor={inputId} className="text-sm font-semibold text-ink">
          Mobile number
        </label>
        <div
          className={`mt-2 flex h-13 items-center overflow-hidden rounded-xl border-[1.5px] bg-sheet transition-colors focus-within:border-sky ${
            showInvalid ? "border-brick" : "border-rule"
          }`}
        >
          <span className="figures flex h-full items-center border-r border-rule bg-paper px-3.5 text-base font-semibold text-ink">
            +91
          </span>
          <input
            id={inputId}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="98765 43210"
            value={withoutCountryCode(request.phoneInput)}
            onChange={(e) => request.setPhoneInput(withoutCountryCode(e.target.value))}
            onBlur={request.onPhoneBlur}
            aria-invalid={showInvalid}
            aria-describedby={hintId}
            className="figures h-full min-w-0 flex-1 bg-transparent px-3.5 text-lg tracking-wide text-ink placeholder:text-faint focus:outline-none focus-visible:outline-none"
          />
        </div>
        <p id={hintId} className={`mt-1.5 min-h-5 text-[13px] ${showInvalid ? "font-medium text-brick" : "text-muted"}`}>
          {showInvalid
            ? "Enter a 10-digit mobile number, like 98765 43210."
            : phone
              ? `We'll call ${displayIndianMobile(phone)}`
              : "The number you want us to call"}
        </p>

        <button
          type="submit"
          disabled={busy || !phone}
          className="mt-3 inline-flex h-13 w-full items-center justify-center gap-2.5 rounded-xl bg-navy text-[17px] font-semibold text-white shadow-[0_10px_22px_-12px_rgb(0_46_110/0.9)] transition-[background-color,transform] hover:bg-navy-deep active:translate-y-px disabled:cursor-not-allowed disabled:bg-navy/25 disabled:shadow-none"
        >
          {starting ? (
            <LoaderCircle aria-hidden size={20} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <PhoneCall aria-hidden size={20} strokeWidth={2.25} />
          )}
          {starting ? "Requesting…" : "Request call back"}
        </button>

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 text-sm font-medium leading-snug text-brick">
            <CircleAlert aria-hidden size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        <p className="mt-4 flex items-start gap-2 border-t border-rule pt-3 text-xs leading-snug text-muted">
          <Info aria-hidden size={14} className="mt-px shrink-0" />
          Prototype: calls only reach numbers verified on our Bolna developer account.
        </p>
      </form>

      <section aria-labelledby={`${inputId}-how`} className="px-1">
        <h2 id={`${inputId}-how`} className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
          How it works
        </h2>
        <ol className="mt-3 space-y-3">
          {HOW_IT_WORKS.map((text, i) => (
            <li key={text} className="flex items-start gap-3 text-sm leading-snug text-ink">
              <span className="figures grid size-6 shrink-0 place-items-center rounded-full bg-sky-wash text-xs font-bold text-navy">
                {i + 1}
              </span>
              <span className="pt-0.5">{text}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-sheet px-3 py-2.5 text-[12.5px] leading-snug text-muted ring-1 ring-rule">
          <ShieldCheck aria-hidden size={15} className="mt-px shrink-0 text-leaf" />
          Closr acts only within Paytm policy and checks every change. Anything bigger goes to a Paytm specialist for
          approval while you&apos;re on the call.
        </p>
      </section>
    </div>
  );
}
