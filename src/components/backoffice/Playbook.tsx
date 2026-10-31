"use client";

import { Activity, BookOpenCheck, CircleAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Lesson } from "@/lib/types";
import { deleteLesson } from "../lib/api";
import { shortDateTime } from "../lib/format";

interface Props {
  /** Newest first, as the server sends them. */
  lessons: Lesson[];
  onChanged: () => void;
}

/** Every "next time" a specialist has taught Closr; each one is applied to every later call and chat. */
export function Playbook({ lessons, onChanged }: Props) {
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  // A removed lesson disappears at once and stays hidden; a failed delete brings it back with the error.
  async function remove(id: string) {
    setError(null);
    setRemoving((prev) => new Set(prev).add(id));
    const result = await deleteLesson(id);
    if (!result.ok) {
      setError({ id, message: result.error });
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    onChanged();
  }

  const shown = lessons.filter((lesson) => !removing.has(lesson.id));

  if (shown.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-paper text-faint ring-1 ring-rule">
          <BookOpenCheck aria-hidden size={20} strokeWidth={1.75} />
        </span>
        <p className="mt-3 max-w-[38ch] text-[14px] leading-relaxed text-muted">
          No coaching yet. When a specialist uses <span className="font-semibold text-ink">Coach Closr</span> on a call
          or chat, the lesson shows up here and Closr applies it to every later conversation.
        </p>
      </div>
    );
  }

  return (
    <ol aria-label="Lessons" className="divide-y divide-rule/70">
      {shown.map((lesson) => (
        <li key={lesson.id} className="flex items-start gap-3 px-5 py-3.5">
          <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full bg-sky" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-snug text-ink [overflow-wrap:anywhere]">{lesson.text}</p>
            <p className="figures mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              <time dateTime={lesson.createdAt}>{shortDateTime(lesson.createdAt)}</time>
              {lesson.sourceCallRef && (
                <>
                  <span aria-hidden className="text-faint">·</span>
                  <a
                    href={`/diagnostics?call=${encodeURIComponent(lesson.sourceCallRef)}`}
                    target="_blank"
                    rel="noopener"
                    title="Open the conversation this lesson came from"
                    className="inline-flex items-center gap-1 font-medium text-navy underline-offset-2 hover:underline"
                  >
                    <Activity aria-hidden size={12} strokeWidth={2.25} />
                    From {lesson.sourceCallRef}
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </>
              )}
            </p>
            {error?.id === lesson.id && (
              <p role="alert" className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-brick">
                <CircleAlert aria-hidden size={14} />
                {error.message}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void remove(lesson.id)}
            aria-label={`Remove lesson: ${lesson.text}`}
            title="Remove from the playbook"
            className="grid size-8 shrink-0 place-items-center rounded-md border border-rule text-muted transition-colors hover:border-brick/40 hover:bg-brick-wash hover:text-brick"
          >
            <Trash2 aria-hidden size={15} strokeWidth={2.25} />
          </button>
        </li>
      ))}
    </ol>
  );
}
