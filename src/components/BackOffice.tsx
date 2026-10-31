"use client";

import { BookOpenCheck, Database, History } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ConsoleState, ProfileKind } from "@/lib/types";
import { CallHistory } from "./backoffice/CallHistory";
import { FollowUpRunner } from "./backoffice/FollowUpRunner";
import { Playbook } from "./backoffice/Playbook";
import { buildTables } from "./backoffice/tables";
import { type Pulses, type TabFocus } from "./hooks/useActivity";
import { useNow } from "./hooks/useNow";
import { PROFILE_TABS, TABS, type TabId } from "./lib/systems";

type View = "records" | "history" | "playbook";

const VIEWS = [
  { id: "records", label: "Records", icon: Database },
  { id: "history", label: "Call history", icon: History },
  { id: "playbook", label: "Playbook", icon: BookOpenCheck },
] as const;

const HEADING: Record<View, { title: string; sub?: string }> = {
  records: { title: "Back office" },
  history: { title: "Call history", sub: "For quality review and internal training" },
  playbook: { title: "Playbook", sub: "Specialists' coaching · applied to every later call and chat" },
};

interface Props {
  state: ConsoleState;
  profile: ProfileKind;
  callerId: string | undefined;
  callerLabel: string;
  pulses: Pulses;
  focus: TabFocus | null;
  refresh: () => void;
  className?: string;
}

export function BackOffice({ state, profile, callerId, callerLabel, pulses, focus, refresh, className = "" }: Props) {
  const [view, setView] = useState<View>("records");
  const [chosen, setChosen] = useState<TabId>(PROFILE_TABS[profile][0]);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const hasPulses = Object.keys(pulses).length > 0;
  const now = useNow(1000, hasPulses);

  const tabs = PROFILE_TABS[profile];
  const active = tabs.includes(chosen) ? chosen : tabs[0];

  useEffect(() => {
    if (!focus) return;
    setChosen(focus.tab);
    setView("records");
  }, [focus]);

  const tables = useMemo(
    () => buildTables(state, { callerId, callerLabel, pulses, now }),
    [state, callerId, callerLabel, pulses, now],
  );
  const current = tables[active];
  const call = state.call;

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = tabs.indexOf(active);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setChosen(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <section aria-labelledby="backoffice-heading" className={`flex flex-col border-rule bg-sheet lg:min-h-0 lg:border-l ${className}`}>
      <header className="@container px-5 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h2 id="backoffice-heading" className="font-serif text-[1.625rem] font-semibold leading-tight text-navy">
              {HEADING[view].title}
            </h2>
            <p className="mt-0.5 text-[14px] text-muted">
              {HEADING[view].sub ?? `${profile === "merchant" ? "Merchant" : "Consumer"} systems · records change as Closr acts`}
            </p>
          </div>
          <div role="group" aria-label="Back office view" className="flex shrink-0 rounded-lg bg-paper p-0.5 ring-1 ring-rule">
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={view === id}
                onClick={() => setView(id)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold transition-colors ${
                  view === id ? "bg-sheet text-navy shadow-[0_1px_2px_rgb(19_35_63/0.12)]" : "text-muted hover:text-ink"
                }`}
              >
                <Icon aria-hidden size={14} strokeWidth={2.25} />
                {label}
                {id === "playbook" && state.lessons.length > 0 && (
                  <span className="figures rounded-full bg-sky-wash px-1.5 text-[11.5px] leading-[1.125rem] text-navy">
                    {state.lessons.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {view === "records" ? (
          <div role="tablist" aria-label="Systems" className="-mx-1 mt-3 flex gap-0.5 overflow-x-auto border-b border-rule px-1 [scrollbar-width:none]">
            {tabs.map((id) => {
              const selected = id === active;
              const { label, icon: Icon } = TABS[id];
              return (
                <button
                  key={id}
                  ref={(el) => {
                    tabRefs.current[id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={selected}
                  aria-controls={`panel-${id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setChosen(id)}
                  onKeyDown={onTabKey}
                  className={`relative -mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2 py-2.5 text-[14px] font-medium transition-colors @3xl:gap-2 @3xl:px-3 ${
                    selected ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  <Icon aria-hidden size={15} strokeWidth={2.25} className="hidden @3xl:block" />
                  {label}
                  <span
                    className={`figures hidden rounded-full px-1.5 text-[11.5px] font-semibold leading-[1.125rem] @2xl:inline ${
                      selected ? "bg-navy/8 text-navy" : "bg-paper text-faint"
                    }`}
                  >
                    {tables[id].count}
                  </span>
                  {tables[id].hot && !selected && (
                    <span className="live-dot absolute right-0.5 top-1.5 size-2 rounded-full bg-sky" aria-label="Just changed" />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 border-b border-rule" />
        )}
      </header>

      {view === "records" ? (
        <div
          role="tabpanel"
          id={`panel-${active}`}
          aria-labelledby={`tab-${active}`}
          className="scrollbar-quiet @container overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        >
          {current.notice && <div className="border-b border-amber-bright/30 bg-amber-wash/60 px-5 py-2.5">{current.notice}</div>}
          {active === "followups" && (
            <FollowUpRunner scheduled={state.followUps.filter((f) => f.status === "scheduled").length} onRan={refresh} />
          )}
          {current.render()}
        </div>
      ) : (
        <div className="scrollbar-quiet @container overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {view === "history" ? (
            <CallHistory trigger={`${call?.callRef ?? ""}:${call?.status ?? ""}`} currentCallRef={call?.callRef} now={now} />
          ) : (
            <Playbook lessons={state.lessons} onChanged={refresh} />
          )}
        </div>
      )}
    </section>
  );
}
