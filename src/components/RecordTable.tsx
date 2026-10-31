"use client";

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

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Every id under which this row may be referenced in a moment's `touched`. */
  matchIds: (row: T) => string[];
  isCaller: (row: T) => boolean;
  callerLabel: string;
  pulses: Pulses;
  now: number;
  empty: string;
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
  pulses,
  now,
  empty,
  minWidth,
}: Props<T>) {
  if (rows.length === 0) {
    return <p className="px-5 py-10 text-center text-[15px] text-muted">{empty}</p>;
  }

  const mine = rows.filter(isCaller);
  const others = rows.filter((r) => !isCaller(r));
  const groups: { label?: string; rows: T[] }[] =
    mine.length && others.length
      ? [
          { label: callerLabel, rows: mine },
          { label: "Other customers", rows: others },
        ]
      : [{ rows: mine.length ? mine : others }];

  const pad = (i: number) => (i === 0 ? "pl-5" : i === columns.length - 1 ? "pr-5" : "");

  return (
    <table className="w-full border-separate border-spacing-0 text-[14px]" style={{ minWidth }}>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th
              key={c.header}
              scope="col"
              className={`sticky top-0 z-10 border-b border-rule bg-sheet px-3 py-2 text-xs font-medium text-muted ${
                c.align === "right" ? "text-right" : "text-left"
              } ${pad(i)} ${c.minor ? "hidden @xl:table-cell" : ""}`}
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
                  className="border-b border-rule bg-paper/70 px-5 py-1.5 text-left text-xs font-semibold text-navy/80"
                >
                  {g.label}
                </th>
              </tr>
            )}
            {g.rows.map((row) => {
              const id = rowKey(row);
              const pulse = isPulsing(pulses, matchIds(row), now);
              return (
                <tr key={`${id}:${pulse ?? 0}`} className={pulse ? "row-touched" : undefined}>
                  {columns.map((c, i) => (
                    <td
                      key={c.header}
                      className={`border-b border-rule/70 px-3 py-2.5 align-top ${
                        c.align === "right" ? "figures text-right" : ""
                      } ${pad(i)} ${c.minor ? "hidden @xl:table-cell" : ""} ${c.className ?? ""}`}
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
