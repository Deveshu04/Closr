"use client";

import { CircleAlert, Gauge, LoaderCircle, Lock, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AutonomyLevel, Workflow } from "@/lib/types";
import { LEVELS, WORKFLOWS } from "./lib/autonomy";
import { setAutonomy } from "./lib/api";
import { inr } from "./lib/format";

type PerWorkflow<T> = Partial<Record<Workflow, T>>;

const SETTABLE: AutonomyLevel[] = [0, 1, 2];
/** How long a saved choice may wait for the polled state to agree before the server's value wins. */
const CONFIRM_MS = 5000;

const CHIP: Record<AutonomyLevel, string> = {
  0: "border border-dashed border-white/45 text-white",
  1: "bg-amber-bright text-navy",
  2: "bg-sky text-navy",
  3: "bg-white text-navy",
};

function without<T>(map: PerWorkflow<T>, key: Workflow): PerWorkflow<T> {
  const next = { ...map };
  delete next[key];
  return next;
}

function meaning(level: AutonomyLevel, limit: number): string {
  return level === 2 ? `Acts alone up to ${inr(limit)}, asks above it` : LEVELS[level].meaning;
}

/** Optimistic per-workflow levels. Choices made while a save is in flight collapse into one request for the newest. */
function useAutonomyControl(server: Record<Workflow, AutonomyLevel>, refresh: () => void) {
  const [wanted, setWanted] = useState<PerWorkflow<AutonomyLevel>>({});
  const [saving, setSaving] = useState<PerWorkflow<boolean>>({});
  const [errors, setErrors] = useState<PerWorkflow<string>>({});
  const latest = useRef<PerWorkflow<AutonomyLevel>>({});
  const queue = useRef<PerWorkflow<Promise<void>>>({});

  useEffect(() => {
    setWanted((prev) => {
      let next = prev;
      for (const { id } of WORKFLOWS) {
        if (prev[id] !== undefined && !saving[id] && prev[id] === server[id]) next = without(next, id);
      }
      return next;
    });
  }, [server, saving]);

  const choose = useCallback(
    (workflow: Workflow, level: AutonomyLevel) => {
      latest.current[workflow] = level;
      setWanted((prev) => ({ ...prev, [workflow]: level }));
      setErrors((prev) => without(prev, workflow));
      setSaving((prev) => ({ ...prev, [workflow]: true }));
      const run = async () => {
        if (latest.current[workflow] !== level) return;
        const result = await setAutonomy(workflow, level);
        if (latest.current[workflow] !== level) return;
        setSaving((prev) => without(prev, workflow));
        if (result.ok) {
          setTimeout(() => setWanted((prev) => (prev[workflow] === level ? without(prev, workflow) : prev)), CONFIRM_MS);
        } else {
          setErrors((prev) => ({ ...prev, [workflow]: result.error }));
          setWanted((prev) => without(prev, workflow));
        }
        refresh();
      };
      queue.current[workflow] = (queue.current[workflow] ?? Promise.resolve()).then(run);
    },
    [refresh],
  );

  const levels = { ...server, ...wanted } as Record<Workflow, AutonomyLevel>;
  return { levels, saving, errors, choose };
}

function LevelPicker({
  workflow,
  label,
  limit,
  level,
  saving,
  error,
  onChoose,
}: {
  workflow: Workflow;
  label: string;
  limit: number;
  level: AutonomyLevel;
  saving: boolean;
  error: string | undefined;
  onChoose: (workflow: Workflow, level: AutonomyLevel) => void;
}) {
  const name = useId();
  const tipId = useId();
  const meaningId = useId();
  return (
    <fieldset aria-describedby={meaningId} className="min-w-0">
      <legend className="flex w-full items-center justify-between gap-3 text-[15px] font-semibold text-ink">
        {label}
        {saving && (
          <span role="status" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted">
            <LoaderCircle aria-hidden size={13} className="animate-spin motion-reduce:animate-none" />
            Saving
          </span>
        )}
      </legend>
      <div className="mt-2 grid grid-cols-4 gap-1 rounded-lg bg-paper p-1 ring-1 ring-rule">
        {SETTABLE.map((value) => {
          const selected = value === level;
          return (
            <label
              key={value}
              title={meaning(value, limit)}
              className={`cursor-pointer rounded-md px-1 py-1.5 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-sky ${
                selected ? "bg-navy text-white shadow-[0_6px_14px_-8px_rgb(0_46_110/0.8)]" : "text-ink hover:bg-sheet"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={value}
                checked={selected}
                onChange={() => onChoose(workflow, value)}
                className="sr-only"
              />
              <span className="block text-[13px] font-bold leading-tight">{LEVELS[value].code}</span>
              <span className={`block truncate text-[11.5px] leading-tight ${selected ? "text-white/80" : "text-muted"}`}>
                {LEVELS[value].name}
              </span>
            </label>
          );
        })}
        <span
          tabIndex={0}
          aria-disabled="true"
          aria-describedby={tipId}
          className="group relative cursor-not-allowed rounded-md px-1 py-1.5 text-center text-faint focus:outline-none focus-visible:outline-2 focus-visible:outline-sky"
        >
          <span className="flex items-center justify-center gap-0.5 text-[13px] font-semibold leading-tight">
            <Lock aria-label="Locked" size={10} strokeWidth={2.5} />
            {LEVELS[3].code}
          </span>
          <span className="block truncate text-[11.5px] leading-tight">{LEVELS[3].name}</span>
          <span
            id={tipId}
            role="tooltip"
            className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-max max-w-[11rem] rounded-md bg-navy px-2.5 py-1.5 text-left text-xs font-semibold leading-snug text-white opacity-0 shadow-[0_10px_24px_-10px_rgb(0_0_0/0.5)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {LEVELS[3].meaning}
          </span>
        </span>
      </div>
      <p id={meaningId} className="mt-1.5 text-[13.5px] leading-snug text-muted">
        <span className="font-semibold text-ink">{LEVELS[level].name}:</span> {meaning(level, limit)}.
      </p>
      {error && (
        <p role="alert" className="mt-1 flex items-start gap-1.5 text-[13px] font-medium text-brick">
          <CircleAlert aria-hidden size={14} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </fieldset>
  );
}

interface Props {
  autonomy: Record<Workflow, AutonomyLevel>;
  refresh: () => void;
}

/** How much Closr may do alone, per money workflow: a glanceable summary that opens the controls. */
export function TrustDial({ autonomy, refresh }: Props) {
  const { levels, saving, errors, choose } = useAutonomyControl(autonomy, refresh);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();

  function show() {
    dialog.current?.showModal();
    setOpen(true);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white/60">
          <Gauge aria-hidden size={14} className="text-sky" />
          Trust dial
        </p>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={show}
          className="-mr-1.5 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-semibold text-sky transition-colors hover:bg-white/10"
        >
          <SlidersHorizontal aria-hidden size={13} strokeWidth={2.5} />
          Adjust
        </button>
      </div>
      <dl className="mt-1.5 space-y-1">
        {WORKFLOWS.map(({ id, label }) => {
          const level = levels[id];
          return (
            <div key={id} className="flex items-center justify-between gap-3">
              <dt className="truncate text-[13.5px] text-white/80">{label}</dt>
              <dd
                title={LEVELS[level].meaning}
                className={`shrink-0 rounded px-1.5 py-px text-[11.5px] font-semibold ${CHIP[level]}`}
              >
                {LEVELS[level].code} {LEVELS[level].name}
              </dd>
            </div>
          );
        })}
      </dl>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // A click on the backdrop lands on the dialog element itself.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-rule bg-sheet p-0 text-ink opacity-100 shadow-[0_30px_70px_-30px_rgb(0_33_79/0.6)] transition-[opacity,translate] duration-200 backdrop:bg-navy-deep/45 starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none"
      >
        <div className="px-5 pb-5 pt-4 sm:px-6">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="flex items-center gap-2 font-serif text-[1.5rem] font-semibold leading-tight text-navy">
                <Gauge aria-hidden size={20} className="text-sky" />
                Trust dial
              </h2>
              <p className="mt-1 text-[14px] leading-snug text-muted">
                How much Closr may do on its own, per money workflow. A change applies from the next payout.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => dialog.current?.close()}
              className="-mr-2 grid size-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-paper hover:text-navy"
            >
              <X aria-hidden size={18} />
            </button>
          </header>
          <div className="mt-5 space-y-5">
            {WORKFLOWS.map(({ id, label, limit }) => (
              <LevelPicker
                key={id}
                workflow={id}
                label={label}
                limit={limit}
                level={levels[id]}
                saving={Boolean(saving[id])}
                error={errors[id]}
                onChoose={choose}
              />
            ))}
          </div>
          <p className="mt-5 border-t border-rule pt-3 text-[12.5px] leading-snug text-faint">
            Set by Paytm care ops. Policy limits still apply at every level; L3 unlocks only after measured accuracy.
          </p>
        </div>
      </dialog>
    </div>
  );
}
