"use client";

import { MotionConfig } from "motion/react";
import { useMemo } from "react";
import { ApprovalToast } from "./ApprovalToast";
import { BackOffice } from "./BackOffice";
import { CallPanel } from "./CallPanel";
import { Header } from "./Header";
import { isPulsing, useActivity } from "./hooks/useActivity";
import { useApprovals } from "./hooks/useApprovals";
import { useConsoleState } from "./hooks/useConsoleState";
import { chronological } from "./lib/moments";
import { MomentsTimeline } from "./MomentsTimeline";

const POLL_MS = 700;
const LIVE = new Set(["dialing", "ringing", "in_progress"]);

export function Console() {
  const { state, loaded, reachable, refresh } = useConsoleState(POLL_MS);
  const { pulses, focus } = useActivity(state, loaded);
  const controls = useApprovals(state.approvals, refresh);

  const call = state.call;
  const callRef = call?.callRef ?? state.moments.at(-1)?.callRef;
  const moments = useMemo(
    () => chronological(state.moments.filter((m) => m.callRef === callRef)),
    [state.moments, callRef],
  );
  const customer = call?.customerId ? state.customers.find((c) => c.id === call.customerId) : undefined;
  // Before anyone has called, the seed's first customer stands in as the demo caller.
  const callerId = call?.customerId ?? state.customers[0]?.id;
  const customerPulse = customer ? isPulsing(pulses, [customer.id], Date.now()) : undefined;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh flex-col lg:h-dvh">
        <Header reachable={reachable} onReset={refresh} />
        <main className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[16.5rem_minmax(0,1.1fr)_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)] 2xl:grid-cols-[19.5rem_minmax(0,1.2fr)_minmax(0,1fr)]">
          <CallPanel
            call={call}
            customer={customer}
            customerPulse={customerPulse}
            refresh={refresh}
            className="lg:col-span-2 xl:col-span-1"
          />
          <MomentsTimeline moments={moments} call={call} controls={controls} />
          <BackOffice
            state={state}
            callerId={callerId}
            callLive={call ? LIVE.has(call.status) : false}
            pulses={pulses}
            focus={focus}
          />
        </main>
        <ApprovalToast controls={controls} />
      </div>
    </MotionConfig>
  );
}
