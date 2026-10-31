"use client";

import { Inbox, type LucideIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { type Pulses, isPulsing } from "./hooks/useActivity";

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "right";
  className?: string;
  /** Dropped when the panel is narrow; the table needs an `@container` ancestor. */
  minor?: boolean;
}

export interface RecordTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Every id under which this row may be referenced in a moment's `touched`. */
  matchIds: (row: T) => string[];
  isCaller: (row: T) => boolean;
  callerLabel: string;
  othersLabel?: string;
  pulses: Pulses;
  now: number;
  empty: string;
  emptyIcon?: LucideIcon;
  minWidth: string;
}

/** Compact table that keeps the caller's records on top and lights up rows the agent just touched. */
export function RecordTable<T>({
  rows,
  columns,
  rowKey,
  matchIds,
  isCaller,
  callerLabel,
  othersLabel = "Other customers",
  pulses,
  now,
  empty,
  emptyIcon: EmptyIcon = Inbox,
  minWidth,
}: RecordTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-paper text-faint ring-1 ring-rule">
          <EmptyIcon aria-hidden size={20} strokeWidth={1.75} />
        </span>
        <p className="mt-3 max-w-[34ch] text-[14px] leading-relaxed text-muted">{empty}</p>
      </div>
    );
  }

  const mine = rows.filter(isCaller);
  const others = rows.filter((r) => !isCaller(r));
  const groups: { label?: string; caller: boolean; rows: T[] }[] =
    mine.length && others.length
      ? [
          { label: callerLabel, caller: true, rows: mine },
          { label: othersLabel, caller: false, rows: others },
        ]
      : [{ caller: mine.length > 0, rows: mine.length ? mine : others }];

  const pad = (i: number) => (i === 0 ? "pl-5" : i === columns.length - 1 ? "pr-5" : "");

  return (
    <table className="w-full border-separate border-spacing-0 text-[14px]" style={{ minWidth }}>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th
              key={c.header}
              scope="col"
              className={`sticky top-0 z-10 border-b border-rule bg-sheet/95 px-3 py-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-faint backdrop-blur-sm ${
                c.align === "right" ? "text-right" : "text-left"
              } ${pad(i)} ${c.minor ? "hidden @2xl:table-cell" : ""}`}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((g, gi) => (
          <Fragment key={g.label ?? gi}>
            {g.label && (
              <tr>
                <th
                  scope="colgroup"
                  colSpan={columns.length}
                  className={`border-b border-rule px-5 py-1.5 text-left text-xs font-semibold ${
                    g.caller ? "bg-sky-wash/70 text-navy shadow-[inset_3px_0_0_var(--color-sky)]" : "bg-paper/80 text-muted"
                  }`}
                >
                  {g.label}
                </th>
              </tr>
            )}
            {g.rows.map((row) => {
              const id = rowKey(row);
              const pulse = isPulsing(pulses, matchIds(row), now);
              return (
                <tr key={`${id}:${pulse ?? 0}`} className={`group ${pulse ? "row-touched" : ""}`}>
                  {columns.map((c, i) => (
                    <td
                      key={c.header}
                      className={`border-b border-rule/70 px-3 py-2.5 align-top transition-colors group-hover:bg-paper/60 ${
                        c.align === "right" ? "figures text-right" : ""
                      } ${pad(i)} ${c.minor ? "hidden @2xl:table-cell" : ""} ${c.className ?? ""}`}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
