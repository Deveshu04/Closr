"use client";

import { LoaderCircle, WifiOff } from "lucide-react";
import { MotionConfig } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PaytmLogo } from "../brand/PaytmLogo";
import { useCallRequest } from "../hooks/useCallRequest";
import { useConsoleState } from "../hooks/useConsoleState";
import { chronological } from "../lib/moments";
import { CallResolution } from "./CallResolution";
import { LiveCall } from "./LiveCall";
import { RequestCallBack } from "./RequestCallBack";
import { callerRecords, customerFeed, summarizeCall } from "./story";

const POLL_MS = 700;

/** What the customer sees in the Paytm app while Closr handles their issue: request, live call, then the outcome. */
export function CustomerApp() {
  const { state, loaded, reachable, refresh } = useConsoleState(POLL_MS);
  const request = useCallRequest(state.call, refresh);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Until a requested call shows up in state, the call in state is the previous one and isn't shown.
  const call = request.pending ? null : state.call;
  const records = useMemo(() => callerRecords(state), [state]);
  const moments = useMemo(
    () => (call ? chronological(state.moments.filter((m) => m.callRef === call.callRef)) : []),
    [state.moments, call],
  );
  const steps = useMemo(() => customerFeed(moments, records), [moments, records]);

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
      <div className="min-h-dvh bg-paper md:flex md:flex-col md:items-center md:justify-center md:gap-3 md:bg-[radial-gradient(circle_at_18%_12%,var(--color-sky-wash),transparent_42%),radial-gradient(circle_at_85%_88%,#e8edf7,transparent_40%)] md:p-6">
        <p className="hidden text-[13px] font-medium text-muted md:block">Customer view · Paytm app</p>
        <div className="flex min-h-dvh w-full flex-col bg-paper md:h-[min(844px,calc(100dvh-5rem))] md:min-h-0 md:w-[390px] md:overflow-hidden md:rounded-[2.75rem] md:border-[10px] md:border-[#0c1830] md:shadow-[0_40px_80px_-30px_rgb(0_33_79/0.55)]">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-rule bg-sheet px-4">
            <PaytmLogo height={20} />
            <span aria-hidden className="h-5 w-px bg-rule" />
            <h1 className="text-[15px] font-semibold text-ink">24x7 Help</h1>
            {!reachable && (
              <p role="status" className="ml-auto flex items-center gap-1.5 text-xs font-medium text-brick">
                <WifiOff aria-hidden size={14} />
                Reconnecting…
              </p>
            )}
          </header>

          <main className="flex-1 md:min-h-0 md:overflow-y-auto md:[scrollbar-width:none]">
            {screen === "loading" && (
              <p role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
                <LoaderCircle aria-hidden size={16} className="animate-spin motion-reduce:animate-none" />
                Loading
              </p>
            )}
            {screen === "live" && (
              <LiveCall
                phase={request.phase}
                elapsed={request.elapsed}
                phone={call?.phone || request.phone}
                steps={steps}
              />
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
              <RequestCallBack request={request} lastCallMissed={call?.status === "failed" && call.callRef !== dismissed} />
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
