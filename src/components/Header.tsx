"use client";

import { Ellipsis, LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ClosrMark } from "./brand/ClosrMark";
import { PaytmLogo } from "./brand/PaytmLogo";
import { resetDemo } from "./lib/api";

function DemoMenu({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setConfirming(false);
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

  async function reset() {
    setBusy(true);
    setError(null);
    const result = await resetDemo();
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setConfirming(false);
      onReset();
    } else {
      setError(result.error);
    }
  }

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
          className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border border-rule bg-sheet p-2 shadow-[0_18px_40px_-18px_rgb(0_33_79/0.4)]"
        >
          {confirming ? (
            <div className="p-2">
              <p className="text-[15px] font-semibold text-ink">Reset the demo data?</p>
              <p className="mt-1 text-sm leading-snug text-muted">
                Every order, refund and ticket goes back to its starting state, and the call history is cleared.
              </p>
              {error && (
                <p role="alert" className="mt-2 text-sm font-medium text-brick">
                  {error}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={reset}
                  disabled={busy}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-brick text-sm font-semibold text-white hover:bg-brick/90 disabled:opacity-60"
                >
                  {busy && <LoaderCircle aria-hidden size={15} className="animate-spin motion-reduce:animate-none" />}
                  Reset demo data
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="h-9 rounded-md border border-rule px-3 text-sm font-medium text-ink hover:bg-paper"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-[15px] text-ink hover:bg-paper"
            >
              <RotateCcw aria-hidden size={16} className="text-muted" />
              Reset demo data
            </button>
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
          <PaytmLogo height={22} />
          <span aria-hidden className="h-6 w-px bg-rule" />
          <span className="whitespace-nowrap text-[1.0625rem] font-semibold leading-none text-navy sm:text-lg">
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
          className="inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-full border border-navy/20 px-3 text-sm font-semibold text-navy transition-colors hover:border-sky hover:bg-sky-wash"
        >
          <span className="sm:hidden">Customer</span>
          <span className="hidden sm:inline">Customer view</span>
          <span aria-hidden>↗</span>
          <span className="sr-only">(opens in a new tab)</span>
        </Link>
        <DemoMenu onReset={onReset} />
      </div>
    </header>
  );
}
