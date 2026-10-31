"use client";

import { Ellipsis, LoaderCircle, type LucideIcon, RotateCcw, Smartphone, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ClosrMark } from "./brand/ClosrMark";
import { PaytmLogo } from "./brand/PaytmLogo";
import { resetDemo } from "./lib/api";

type ResetKind = "data" | "everything";

const RESETS: Record<ResetKind, { label: string; icon: LucideIcon; question: string; detail: string; confirm: string }> = {
  data: {
    label: "Reset demo data",
    icon: RotateCcw,
    question: "Reset the demo data?",
    detail:
      "Every payment, dispute, settlement, Soundbox, payout and ticket goes back to its starting state. Call history and transcripts are kept.",
    confirm: "Reset demo data",
  },
  everything: {
    label: "Reset demo data and clear call history",
    icon: Trash2,
    question: "Reset the data and clear call history?",
    detail:
      "Every record goes back to its starting state, and every past call and its transcript is deleted. This can't be undone.",
    confirm: "Reset and clear history",
  },
};

function DemoMenu({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<ResetKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setConfirming(null);
      setError(null);
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function reset(kind: ResetKind) {
    setBusy(true);
    setError(null);
    const result = await resetDemo({ clearHistory: kind === "everything" });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setConfirming(null);
      onReset();
    } else {
      setError(result.error);
    }
  }

  const pending = confirming ? RESETS[confirming] : null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Demo options"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-navy/5 hover:text-navy"
      >
        <Ellipsis aria-hidden size={20} />
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute right-0 top-full z-40 mt-2 w-[19rem] rounded-lg border border-rule bg-sheet p-2 shadow-[0_18px_40px_-18px_rgb(0_33_79/0.4)]"
        >
          {confirming && pending ? (
            <div className="p-2">
              <p className="text-[15px] font-semibold text-ink">{pending.question}</p>
              <p className="mt-1 text-sm leading-snug text-muted">{pending.detail}</p>
              {error && (
                <p role="alert" className="mt-2 text-sm font-medium text-brick">
                  {error}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => reset(confirming)}
                  disabled={busy}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-brick px-3 text-sm font-semibold text-white hover:bg-brick/90 disabled:opacity-60"
                >
                  {busy && <LoaderCircle aria-hidden size={15} className="animate-spin motion-reduce:animate-none" />}
                  {pending.confirm}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="h-9 rounded-md border border-rule px-3 text-sm font-medium text-ink hover:bg-paper"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ul>
              {(Object.keys(RESETS) as ResetKind[]).map((kind) => {
                const { label, icon: Icon } = RESETS[kind];
                return (
                  <li key={kind}>
                    <button
                      type="button"
                      onClick={() => setConfirming(kind)}
                      className={`flex w-full items-start gap-2.5 rounded-md px-3 py-2.5 text-left text-[14.5px] leading-snug hover:bg-paper ${
                        kind === "everything" ? "text-brick" : "text-ink"
                      }`}
                    >
                      <Icon aria-hidden size={16} className={`mt-0.5 shrink-0 ${kind === "everything" ? "" : "text-muted"}`} />
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function Header({ reachable, onReset }: { reachable: boolean; onReset: () => void }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-rule bg-sheet px-4 py-3 sm:px-5 lg:px-8">
      <div className="flex min-w-0 items-center gap-x-5">
        <h1 className="flex items-center gap-2.5 sm:gap-3">
          <PaytmLogo height={22} className="max-sm:h-5!" />
          <span aria-hidden className="h-6 w-px bg-rule" />
          <span className="whitespace-nowrap text-base font-semibold leading-none text-navy sm:text-lg">
            Care Console
          </span>
        </h1>
        <p className="hidden items-center gap-2 rounded-full bg-sky-wash py-1 pl-1.5 pr-3 text-sm font-medium text-navy md:inline-flex">
          <span className="grid size-6 place-items-center rounded-full bg-navy text-white">
            <ClosrMark className="size-4" />
          </span>
          <span>
            <span className="font-semibold">Closr</span> · AI teammate
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-3">
        {!reachable && (
          <p role="status" className="flex items-center gap-2 text-sm font-medium text-brick">
            <span aria-hidden className="size-2 rounded-full bg-brick" />
            <span className="hidden sm:inline">Console server not answering. Retrying.</span>
            <span className="sr-only sm:hidden">Offline</span>
          </p>
        )}
        <Link
          href="/customer"
          target="_blank"
          rel="noopener noreferrer"
          title="Customer view"
          className="inline-flex size-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-navy/20 text-sm font-semibold text-navy transition-colors hover:border-sky hover:bg-sky-wash sm:w-auto sm:px-3"
        >
          <Smartphone aria-hidden size={16} strokeWidth={2.25} />
          <span className="sr-only sm:not-sr-only">Customer view</span>
          <span aria-hidden className="hidden sm:inline">↗</span>
          <span className="sr-only">(opens in a new tab)</span>
        </Link>
        <DemoMenu onReset={onReset} />
      </div>
    </header>
  );
}
