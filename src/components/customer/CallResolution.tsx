"use client";

import { MessageSquareHeart, PhoneCall, PhoneOff, Star } from "lucide-react";
import { useId, useState } from "react";
import type { CallRecord } from "@/lib/types";
import { StatusPill } from "../StatusPill";
import { clockTime, duration } from "../lib/format";
import { readRatings, saveRating } from "../lib/ratings";
import { BUBBLE } from "./LiveCall";
import type { Outcome, TicketRef } from "./story";

const STAR_WORDS = ["", "Poor", "Fair", "Okay", "Good", "Excellent"];

interface Props {
  call: CallRecord;
  elapsed: number | null;
  outcomes: Outcome[];
  tickets: TicketRef[];
  onRequestAgain: () => void;
}

export function CallResolution({ call, elapsed, outcomes, tickets, onRequestAgain }: Props) {
  const dropped = call.status === "failed";

  return (
    <div className="space-y-4 p-4">
      <section aria-labelledby="resolution-heading" className="card overflow-hidden">
        <header className="flex items-center gap-3 border-b border-rule bg-paper/70 px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sky-wash text-navy">
            <PhoneOff aria-hidden size={18} strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="resolution-heading" className="text-[17px] font-semibold leading-tight text-ink">
              {dropped ? "Call disconnected" : "Call ended"}
            </h2>
            <p className="figures mt-0.5 text-[13px] text-muted">
              {elapsed !== null && <>Duration {duration(elapsed)} · </>}
              {clockTime(call.endedAt ?? call.startedAt)}
            </p>
          </div>
        </header>

        <div className="px-5 py-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">What Closr did for you</h3>
          {outcomes.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {outcomes.map((o) => (
                <OutcomeRow key={o.id} outcome={o} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-muted">
              No changes were made on this call. If something still isn&apos;t right, request another call back.
            </p>
          )}

          {tickets.length > 0 && (
            <div className="mt-4 border-t border-rule pt-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Your tickets</h3>
              <ul className="mt-2 space-y-2">
                {tickets.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="figures font-semibold text-navy">{t.id}</span>
                      {t.subject && <span className="block truncate text-[13px] text-muted">{t.subject}</span>}
                    </span>
                    <StatusPill value={t.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <RateCall key={call.callRef} callRef={call.callRef} />

      <button
        type="button"
        onClick={onRequestAgain}
        className="inline-flex h-13 w-full items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-navy bg-sheet text-[16px] font-semibold text-navy transition-colors hover:bg-sky-wash active:translate-y-px"
      >
        <PhoneCall aria-hidden size={19} strokeWidth={2.25} />
        Request another call back
      </button>
    </div>
  );
}

function OutcomeRow({ outcome }: { outcome: Outcome }) {
  const Icon = outcome.icon;
  const handoff = outcome.tone === "handoff";
  return (
    <li className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ${handoff ? "bg-sky-wash" : "bg-paper/70"}`}>
      <span className={`relative grid size-9 shrink-0 place-items-center rounded-full ${BUBBLE[outcome.tone]}`}>
        <Icon aria-hidden size={17} strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className={`text-[15px] font-semibold leading-snug ${outcome.tone === "problem" ? "text-brick" : "text-ink"}`}>
          {outcome.title}
        </p>
        {outcome.detail && <p className="figures mt-0.5 text-[13px] leading-snug text-muted">{outcome.detail}</p>}
      </div>
    </li>
  );
}

function RateCall({ callRef }: { callRef: string }) {
  const name = useId();
  const [stars, setStars] = useState(() => readRatings()[callRef] ?? 0);
  const [hover, setHover] = useState(0);
  const shown = hover || stars;

  function rate(value: number) {
    setStars(value);
    saveRating(callRef, value);
  }

  return (
    <fieldset className="card px-5 py-4">
      <legend className="sr-only">Rate this call</legend>
      <p aria-hidden className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <MessageSquareHeart size={17} className="text-sky" />
        Rate this call
      </p>
      <p className="mt-0.5 text-[13px] text-muted">Your rating helps us train Closr.</p>
      <div className="mt-3 flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            onMouseEnter={() => setHover(n)}
            className="cursor-pointer rounded-lg p-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-sky"
          >
            <input
              type="radio"
              name={name}
              value={n}
              checked={stars === n}
              onChange={() => rate(n)}
              className="sr-only"
            />
            <Star
              aria-hidden
              size={30}
              strokeWidth={1.75}
              className={`transition-colors ${n <= shown ? "fill-amber-bright text-amber-bright" : "text-faint/60"}`}
            />
            <span className="sr-only">
              {n} {n === 1 ? "star" : "stars"}, {STAR_WORDS[n]}
            </span>
          </label>
        ))}
      </div>
      <p aria-live="polite" className="mt-1.5 min-h-5 text-sm font-medium text-ink">
        {stars ? `Thanks! You rated this call ${stars} out of 5.` : STAR_WORDS[shown]}
      </p>
    </fieldset>
  );
}
