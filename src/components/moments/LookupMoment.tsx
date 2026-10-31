import { Database } from "lucide-react";
import type { Moment } from "@/lib/types";
import { keyFields, pickString } from "../lib/data";
import { systemOf } from "../lib/systems";
import { FieldGrid, StatusNote, surfaceFor } from "./shared";

/** A record pulled from a system, drawn as a filed card with the system on its tab. */
export function LookupMoment({ moment }: { moment: Moment }) {
  const system = systemOf(moment.system);
  const Icon = system?.icon ?? Database;
  const recordId = pickString(moment.data, "id", "recordId") ?? moment.touched?.[0];
  const fields = keyFields(moment.data, ["id", "recordId"], 9);

  return (
    <article>
      <div className="flex items-end gap-3">
        <span className="relative z-10 -mb-px inline-flex items-center gap-1.5 rounded-t-md border border-b-0 border-rule bg-sheet px-3 py-1.5 text-[13px] font-semibold text-navy">
          <Icon aria-hidden size={14} strokeWidth={2.25} />
          {system?.label ?? "System"}
        </span>
        {recordId && <span className="figures truncate pb-1.5 text-[13px] text-muted">{recordId}</span>}
      </div>
      <div
        className={`rounded-tr-lg rounded-b-lg border border-rule bg-sheet px-4 py-3 shadow-[0_1px_2px_rgb(0_46_110/0.06)] ${surfaceFor(moment.status)}`}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[17px] font-semibold leading-snug text-ink">{moment.title}</h3>
          <StatusNote status={moment.status} className="pt-0.5" />
        </div>
        {moment.detail && <p className="mt-0.5 text-[15px] text-muted">{moment.detail}</p>}
        {fields.length > 0 ? (
          <FieldGrid fields={fields} className="mt-3 border-t border-dashed border-rule pt-3" />
        ) : (
          moment.status === "running" && (
            <div aria-hidden className="mt-3 grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-8 rounded bg-paper" />
              ))}
            </div>
          )
        )}
      </div>
    </article>
  );
}
