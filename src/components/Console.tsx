"use client";

import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProfileKind } from "@/lib/types";
import { ApprovalToast } from "./ApprovalToast";
import { BackOffice } from "./BackOffice";
import { CallPanel, type ProfileOption } from "./CallPanel";
import { Header } from "./Header";
import { isPulsing, useActivity } from "./hooks/useActivity";
import { useApprovals } from "./hooks/useApprovals";
import { LIVE_PHASES } from "./hooks/useCallRequest";
import { useConsoleState } from "./hooks/useConsoleState";
import { chronological } from "./lib/moments";
import { channelOf, demoCustomer } from "./lib/records";
import { MomentsTimeline } from "./MomentsTimeline";

const POLL_MS = 700;
const PROFILE_KEY = "closr.consoleProfile";

export function Console() {
  const { state, loaded, reachable, refresh } = useConsoleState(POLL_MS);
  const { pulses, focus } = useActivity(state, loaded);
  const controls = useApprovals(state.approvals, refresh);
  const [profile, setProfile] = useState<ProfileKind>("consumer");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PROFILE_KEY);
      if (saved === "consumer" || saved === "merchant") setProfile(saved);
    } catch {
      // Storage can be blocked; the console starts on the consumer profile.
    }
  }, []);

  const chooseProfile = useCallback((kind: ProfileKind) => {
    setProfile(kind);
    try {
      window.localStorage.setItem(PROFILE_KEY, kind);
    } catch {
      // Remembering the profile is a convenience only.
    }
  }, []);

  const call = state.call;
  const live = call ? LIVE_PHASES.has(call.status) : false;
  const callCustomer = call?.customerId ? state.customers.find((c) => c.id === call.customerId) : undefined;

  const callKind = callCustomer?.kind;

  // A live call decides the profile, whichever screen placed it.
  useEffect(() => {
    if (live && callKind) setProfile(callKind);
  }, [live, callKind]);

  const callRef = call?.callRef ?? state.moments.at(-1)?.callRef;
  const moments = useMemo(
    () => chronological(state.moments.filter((m) => m.callRef === callRef)),
    [state.moments, callRef],
  );

  const options: ProfileOption[] = (["consumer", "merchant"] as const).map((kind) => ({
    kind,
    customer: demoCustomer(state.customers, kind),
  }));
  const role = live ? "live" : callCustomer?.kind === profile ? "last" : "demo";
  const customer = role === "demo" ? options.find((o) => o.kind === profile)?.customer : callCustomer;
  const customerPulse = customer ? isPulsing(pulses, [customer.id], Date.now()) : undefined;
  const displayName = customer ? (customer.kind === "merchant" ? (customer.business?.name ?? customer.name) : customer.name) : undefined;
  const chat = channelOf(call) === "chat";
  const callerLabel = displayName
    ? role === "live"
      ? `${displayName}, ${chat ? "in this chat" : "on this call"}`
      : role === "last"
        ? `${displayName}, last ${chat ? "chat" : "call"}`
        : `${displayName}, demo ${profile}`
    : chat
      ? "In this chat"
      : "On this call";

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh flex-col lg:h-dvh">
        <Header reachable={reachable} onReset={refresh} />
        <main className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[16.5rem_minmax(0,1.1fr)_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)] 2xl:grid-cols-[19.5rem_minmax(0,1.05fr)_minmax(0,1fr)]">
          <CallPanel
            call={call}
            profile={profile}
            onProfile={chooseProfile}
            options={options}
            customer={customer}
            customerRole={role}
            customerPulse={customerPulse}
            refresh={refresh}
            className="lg:col-span-2 xl:col-span-1"
          />
          <MomentsTimeline moments={moments} call={call} customer={callCustomer} controls={controls} />
          <BackOffice
            state={state}
            profile={profile}
            callerId={customer?.id}
            callerLabel={callerLabel}
            pulses={pulses}
            focus={focus}
          />
        </main>
        <ApprovalToast controls={controls} />
      </div>
    </MotionConfig>
  );
}
