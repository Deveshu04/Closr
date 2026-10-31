import { Headset } from "lucide-react";
import type { Moment } from "@/lib/types";
import { humanize } from "../lib/format";
import { pickString } from "../lib/data";
import { StatusNote } from "./shared";

/** A handoff slip for a human: perforated like a ticket stub, with the brief written out. */
export function EscalatedMoment({ moment }: { moment: Moment }) {
  const brief = pickString(moment.data, "brief", "summary", "handoff", "note") ?? moment.detail;
  const ticketId = pickString(moment.data, "ticketId", "ticket_id") ?? moment.touched?.[0];
  const priority = pickString(moment.data, "priority");
  const team = pickString(moment.data, "team", "queue", "assignee", "assignedTo");

  return (
    <article className="perforated rounded-r-lg border border-dashed border-navy/45 bg-sheet py-3.5 pl-7 pr-4">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <h3 className="flex min-w-0 items-center gap-2 text-[17px] font-semibold leading-snug text-navy">
          <Headset aria-hidden size={18} className="shrink-0" />
          {moment.title}
        </h3>
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
      {(priority || team) && (
        <p className="mt-2.5 flex flex-wrap gap-x-4 text-sm text-muted">
          {priority && (
            <span>
              Priority <span className={`font-semibold ${/high|urgent/i.test(priority) ? "text-brick" : "text-ink"}`}>{humanize(priority)}</span>
            </span>
          )}
          {team && (
            <span>
              Assigned to <span className="font-semibold text-ink">{team}</span>
            </span>
          )}
        </p>
      )}
    </article>
  );
}
