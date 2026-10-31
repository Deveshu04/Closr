import { ArrowUpRight, Headset } from "lucide-react";
import type { Moment } from "@/lib/types";
import { humanize } from "../lib/format";
import { pickNumber, pickString } from "../lib/data";
import { StatusNote } from "./shared";

/** A handoff slip for a human: perforated like a ticket stub, with the brief written out. */
export function EscalatedMoment({ moment }: { moment: Moment }) {
  const brief = pickString(moment.data, "brief", "summary", "handoff", "note") ?? moment.detail;
  const ticketId = pickString(moment.data, "ticketId", "ticket_id") ?? moment.touched?.[0];
  const priority = pickString(moment.data, "priority");
  const team = pickString(moment.data, "team", "queue", "assignee", "assignedTo");
  const routedTo = pickString(moment.data, "routedTo", "routed_to");
  const callbackHours = pickNumber(moment.data, "callbackWithinHours", "callbackHours", "callback_within_hours");

  return (
    <article className="perforated rounded-r-lg border border-dashed border-navy/45 bg-sheet py-3.5 pl-7 pr-4 shadow-[0_1px_2px_rgb(0_46_110/0.06)]">
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-navy/65">
        <span className="grid size-5 place-items-center rounded-full bg-navy text-white">
          <Headset aria-hidden size={12} strokeWidth={2.25} />
        </span>
        Human handoff
      </p>
      <header className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <h3 className="min-w-0 text-[17px] font-semibold leading-snug text-navy">{moment.title}</h3>
        <div className="flex items-center gap-2">
          <StatusNote status={moment.status} />
          {ticketId && (
            <span className="stamp-face rounded-[3px] border border-navy/40 px-2 py-0.5 text-[15px] font-bold uppercase text-navy">
              {ticketId}
            </span>
          )}
        </div>
      </header>
      {brief && (
        <p className="mt-2 max-w-[64ch] border-l-2 border-sky/60 pl-3 font-serif text-[17px] leading-relaxed text-ink">
          {brief}
        </p>
      )}
      {(priority || team || routedTo || callbackHours !== undefined) && (
        <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {routedTo && (
            <span className="inline-flex items-center gap-1">
              <ArrowUpRight aria-hidden size={14} className="text-navy" />
              Routed to <span className="font-semibold text-ink">{routedTo}</span>
            </span>
          )}
          {priority && (
            <span>
              Priority{" "}
              <span className={`font-semibold ${/high|urgent/i.test(priority) ? "text-brick" : "text-ink"}`}>{humanize(priority)}</span>
            </span>
          )}
          {team && (
            <span>
              Assigned to <span className="font-semibold text-ink">{team}</span>
            </span>
          )}
          {callbackHours !== undefined && (
            <span className="figures">
              Call back within <span className="font-semibold text-ink">{callbackHours} h</span>
            </span>
          )}
        </p>
      )}
    </article>
  );
}
