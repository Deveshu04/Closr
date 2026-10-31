import { Lightbulb, UserRoundCheck } from "lucide-react";
import type { Moment } from "@/lib/types";
import { LEVELS, WORKFLOWS } from "../lib/autonomy";
import { pickNumber, pickString } from "../lib/data";
import { inr } from "../lib/format";

/** "Crediting ₹50 cashback to …" reads as "Closr suggests crediting ₹50 cashback to …". */
function asSuggestion(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** Trust dial L0: Closr did the diagnosis and policy check, then stopped short of moving money. */
export function ShadowMoment({ moment }: { moment: Moment }) {
  const suggestion = pickString(moment.data, "suggestion");
  const workflow = WORKFLOWS.find((w) => w.id === pickString(moment.data, "workflow"));
  const ticketId = pickString(moment.data, "ticketId");
  const amount = pickNumber(moment.data, "amount");

  return (
    <article className="rounded-lg border-[1.5px] border-dashed border-navy/40 bg-sky-wash/60 px-4 py-3.5">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-navy/70">
        <span className="grid size-5 place-items-center rounded-full bg-sky text-navy">
          <Lightbulb aria-hidden size={12} strokeWidth={2.5} />
        </span>
        Shadow suggestion
        <span className="font-medium normal-case tracking-normal text-muted">
          · {LEVELS[0].code} {LEVELS[0].name}
          {workflow && ` for ${workflow.label.toLowerCase()}`}
        </span>
      </p>
      <header className="mt-1.5 flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
        <h3 className="min-w-0 flex-[1_1_14rem] text-[17px] font-semibold leading-snug text-navy">
          {suggestion ? (
            <>
              <span className="font-normal text-muted">Closr suggests </span>
              {asSuggestion(suggestion)}
            </>
          ) : (
            moment.title
          )}
        </h3>
        {amount !== undefined && (
          <p className="figures font-serif text-[1.75rem] font-semibold leading-none text-navy">{inr(amount)}</p>
        )}
      </header>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink/80">
        <UserRoundCheck aria-hidden size={15} className="shrink-0 text-navy" />
        A specialist reviews and completes it. Closr moved no money.
        {ticketId && (
          <span className="stamp-face rounded-[3px] border border-navy/30 px-1.5 text-[13px] font-bold uppercase text-navy">
            {ticketId}
          </span>
        )}
      </p>
    </article>
  );
}
