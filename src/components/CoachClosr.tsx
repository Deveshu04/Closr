"use client";

import { BadgeCheck, CircleAlert, GraduationCap, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { addLesson } from "./lib/api";

const MAX_LENGTH = 300;
const PREFIX = "Next time, ";
const TOAST_MS = 5000;

interface Props {
  open: boolean;
  onClose: () => void;
  /** The call or chat being coached; saved with the lesson so the playbook can point back to it. */
  callRef: string | undefined;
  onSaved: () => void;
}

/** A specialist's "next time, do X" after reviewing a conversation; Closr applies it to every later one. */
export function CoachClosr({ open, onClose, callRef, onSaved }: Props) {
  const [draft, setDraft] = useState(PREFIX);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const hintId = useId();

  useEffect(() => {
    if (!open) return;
    const el = field.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [open]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(0), TOAST_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const lesson = draft.trim();
  const empty = lesson.replace(/^next time,?/i, "").trim() === "";

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (empty || busy) return;
    setBusy(true);
    setError(null);
    const result = await addLesson(lesson, callRef);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(PREFIX);
    setSaved(Date.now());
    onSaved();
    onClose();
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  }

  return (
    <>
      {open && (
        <form
          onSubmit={save}
          onKeyDown={onKeyDown}
          aria-label="Coach Closr"
          className="mt-2 w-full max-w-[44rem] rounded-lg border border-sky/45 bg-sheet px-4 py-3 shadow-[0_10px_24px_-18px_rgb(0_46_110/0.45)]"
        >
          <label htmlFor={fieldId} className="flex items-center gap-1.5 text-[14px] font-semibold text-navy">
            <GraduationCap aria-hidden size={16} strokeWidth={2.25} className="text-sky" />
            Coach Closr
          </label>
          <p id={hintId} className="mt-0.5 text-[13px] leading-snug text-muted">
            One instruction for next time. It goes in the playbook and applies to every later call and chat.
          </p>
          <textarea
            ref={field}
            id={fieldId}
            rows={2}
            maxLength={MAX_LENGTH}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            aria-describedby={hintId}
            placeholder="Next time, …"
            className="mt-2 block w-full resize-none rounded-md border border-rule bg-paper/60 px-3 py-2 text-[15px] leading-snug text-ink placeholder:text-faint focus:border-sky focus:bg-sheet focus:outline-none"
          />
          {error && (
            <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[13px] font-medium text-brick">
              <CircleAlert aria-hidden size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="figures text-[12px] text-faint">
              {draft.length}/{MAX_LENGTH}
              <span className="hidden sm:inline"> · Ctrl+Enter to save</span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-md border border-rule px-3 text-[13px] font-medium text-ink hover:bg-paper"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={empty || busy}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-navy px-4 text-[13px] font-semibold text-white transition-colors hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <LoaderCircle aria-hidden size={14} className="animate-spin motion-reduce:animate-none" />}
                Save lesson
              </button>
            </div>
          </div>
        </form>
      )}

      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-3 sm:justify-start sm:p-6"
      >
        <AnimatePresence>
          {saved > 0 && (
            <motion.p
              key={saved}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.25 }}
              className="pointer-events-auto flex max-w-[26rem] items-start gap-2.5 rounded-xl bg-navy px-4 py-3 text-[14px] leading-snug text-white shadow-[0_24px_50px_-20px_rgb(0_33_79/0.7)]"
            >
              <BadgeCheck aria-hidden size={18} className="mt-px shrink-0 text-sky" />
              <span>
                <span className="font-semibold">Saved to the playbook.</span> Closr will use this on every call and chat
                from now on.
              </span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
