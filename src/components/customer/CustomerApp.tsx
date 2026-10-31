"use client";

import { LoaderCircle, Store, WifiOff } from "lucide-react";
import { MotionConfig } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Customer, ProfileKind } from "@/lib/types";
import { PaytmLogo } from "../brand/PaytmLogo";
import { useCallRequest } from "../hooks/useCallRequest";
import { useConsoleState } from "../hooks/useConsoleState";
import { lastFour } from "../lib/format";
import { chronological } from "../lib/moments";
import { demoCustomer, firstName } from "../lib/records";
import { CallResolution } from "./CallResolution";
import { LiveCall } from "./LiveCall";
import { RequestCallBack } from "./RequestCallBack";
import { callerRecords, customerFeed, summarizeCall } from "./story";

const POLL_MS = 700;
const APP_KEY = "closr.customerApp";
const APP_PARAM: Record<ProfileKind, string> = { consumer: "personal", merchant: "business" };
const APPS: { kind: ProfileKind; label: string }[] = [
  { kind: "consumer", label: "Paytm app" },
  { kind: "merchant", label: "Paytm for Business" },
];

function AppSwitch({ value, onChange }: { value: ProfileKind; onChange: (kind: ProfileKind) => void }) {
  return (
    <div className="flex items-center justify-center gap-3 bg-navy-deep px-4 py-2 md:bg-transparent md:p-0">
      <span className="text-[12px] font-medium text-white/60 md:text-muted">Demo</span>
      <div role="group" aria-label="Which app" className="flex rounded-full bg-white/10 p-0.5 md:bg-sheet md:shadow-[0_1px_2px_rgb(19_35_63/0.08)] md:ring-1 md:ring-rule">
        {APPS.map((app) => {
          const selected = app.kind === value;
          return (
            <button
              key={app.kind}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(app.kind)}
              className={`h-7 rounded-full px-3 text-[12.5px] font-semibold transition-colors ${
                selected ? "bg-white text-navy md:bg-navy md:text-white" : "text-white/75 hover:text-white md:text-muted md:hover:text-navy"
              }`}
            >
              {app.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AppHeader({ app, user, offline }: { app: ProfileKind; user: Customer | undefined; offline: boolean }) {
  const status = offline && (
    <p role="status" className="ml-auto flex items-center gap-1.5 text-xs font-medium text-brick">
      <WifiOff aria-hidden size={14} />
      Reconnecting…
    </p>
  );
  if (app === "consumer") {
    return (
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-rule bg-sheet px-4">
        <PaytmLogo height={20} />
        <span aria-hidden className="h-5 w-px bg-rule" />
        <h1 className="text-[15px] font-semibold text-ink">24x7 Help</h1>
        {status}
      </header>
    );
  }
  const business = user?.business;
  return (
    <header className="sticky top-0 z-20 shrink-0 bg-sheet">
      <div className="flex h-12 items-center gap-2 px-4">
        <PaytmLogo height={18} />
        <span className="text-[14px] font-semibold tracking-tight text-navy">for Business</span>
        {status}
      </div>
      <div className="flex items-center gap-3 bg-navy px-4 py-3 text-white">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
          <Store aria-hidden size={19} className="text-sky" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[16px] font-semibold leading-tight">{business?.name ?? "Your business"}</h1>
          <p className="figures mt-0.5 truncate text-[12.5px] text-white/65">
            {business ? (
              <>
                <span title={`MID ${business.mid}`}>MID {lastFour(business.mid)}</span>
                {user?.city && <> · {user.city}</>}
              </>
            ) : (
              "Business help"
            )}
          </p>
        </div>
        <span className="rounded-full bg-sky/15 px-2 py-0.5 text-[11.5px] font-semibold text-sky">Help</span>
      </div>
    </header>
  );
}

/** What the customer sees in the Paytm app while Closr handles their issue: request, live call, then the outcome. */
export function CustomerApp() {
  const { state, loaded, reachable, refresh } = useConsoleState(POLL_MS);
  const [app, setApp] = useState<ProfileKind>("consumer");
  const request = useCallRequest(state.call, refresh, app);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("app");
    if (param === APP_PARAM.merchant) return setApp("merchant");
    if (param === APP_PARAM.consumer) return setApp("consumer");
    try {
      if (window.localStorage.getItem(APP_KEY) === "merchant") setApp("merchant");
    } catch {
      // Storage can be blocked; the Paytm app is the default.
    }
  }, []);

  const chooseApp = useCallback((kind: ProfileKind) => {
    setApp(kind);
    try {
      window.localStorage.setItem(APP_KEY, kind);
    } catch {
      // Remembering the app is a convenience only.
    }
    const url = new URL(window.location.href);
    url.searchParams.set("app", APP_PARAM[kind]);
    window.history.replaceState(null, "", url);
  }, []);

  const callKind = state.call?.customerId ? state.customers.find((c) => c.id === state.call?.customerId)?.kind : undefined;

  // A call in progress belongs to one app; show it there.
  useEffect(() => {
    if (request.live && callKind) setApp(callKind);
  }, [request.live, callKind]);

  // Until a requested call shows up in state, the call in state is the previous one and isn't shown;
  // a finished call placed for the other app isn't shown here either.
  const call = request.pending || (callKind && callKind !== app && !request.live) ? null : state.call;
  const records = useMemo(() => callerRecords(state), [state]);
  const moments = useMemo(
    () => (call ? chronological(state.moments.filter((m) => m.callRef === call.callRef)) : []),
    [state.moments, call],
  );
  const steps = useMemo(() => customerFeed(moments, records), [moments, records]);
  const user = demoCustomer(state.customers, app);

  const ended = call !== null && (call.status === "completed" || call.status === "failed") && call.callRef !== dismissed;
  const talked = moments.some((m) => m.kind !== "call");
  const screen = !loaded
    ? "loading"
    : request.live && !request.stale
      ? "live"
      : ended && (call.status === "completed" || talked)
        ? "ended"
        : "request";

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh bg-paper md:flex md:flex-col md:items-center md:justify-center md:gap-4 md:bg-[radial-gradient(circle_at_18%_12%,var(--color-sky-wash),transparent_42%),radial-gradient(circle_at_85%_88%,#e8edf7,transparent_40%)] md:p-6">
        <AppSwitch value={app} onChange={chooseApp} />
        <div className="flex min-h-[calc(100dvh-2.75rem)] w-full flex-col bg-paper md:h-[min(844px,calc(100dvh-7rem))] md:min-h-0 md:w-[390px] md:overflow-hidden md:rounded-[2.75rem] md:border-[10px] md:border-[#0c1830] md:shadow-[0_40px_80px_-30px_rgb(0_33_79/0.55)]">
          <AppHeader app={app} user={user} offline={!reachable} />

          <main className="flex-1 md:min-h-0 md:overflow-y-auto md:[scrollbar-width:none]">
            {screen === "loading" && (
              <p role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
                <LoaderCircle aria-hidden size={16} className="animate-spin motion-reduce:animate-none" />
                Loading
              </p>
            )}
            {screen === "live" && (
              <LiveCall app={app} phase={request.phase} elapsed={request.elapsed} phone={call?.phone || request.phone} steps={steps} />
            )}
            {screen === "ended" && call && (
              <CallResolution
                call={call}
                elapsed={request.elapsed}
                {...summarizeCall(moments, records)}
                onRequestAgain={() => setDismissed(call.callRef)}
              />
            )}
            {screen === "request" && (
              <RequestCallBack
                app={app}
                firstName={user ? firstName(user.name) : undefined}
                request={request}
                lastCallMissed={call?.status === "failed" && call.callRef !== dismissed}
              />
            )}
          </main>

          <footer className="shrink-0 border-t border-rule bg-sheet px-4 py-2.5 text-center">
            <Link href="/" className="text-[13px] font-medium text-muted underline-offset-2 hover:text-navy hover:underline">
              Care console
            </Link>
          </footer>
        </div>
      </div>
    </MotionConfig>
  );
}
