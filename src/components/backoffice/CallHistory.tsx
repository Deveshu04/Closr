"use client";

import { Activity, Download, History, Star } from "lucide-react";
import { type PastCall, useCallHistory } from "../hooks/useCallHistory";
import { LIVE_PHASES } from "../hooks/useCallRequest";
import { transcriptUrl } from "../lib/api";
import { duration, shortDateTime } from "../lib/format";
import { maskIndianMobile } from "../lib/phone";
import { type Column, RecordTable } from "../RecordTable";
import { StatusPill } from "../StatusPill";

interface Props {
  /** Changes whenever a call starts or ends, so the list refetches at once. */
  trigger: string;
  currentCallRef: string | undefined;
  now: number;
}

function RatingMark({ stars }: { stars: number | undefined }) {
  if (!stars) return null;
  return (
    <span
      title={`Customer rated this call ${stars} out of 5`}
      className="figures inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-wash px-2 py-0.5 text-[12.5px] font-semibold text-amber"
    >
      <Star aria-hidden size={12} className="fill-amber-bright text-amber-bright" />
      {stars}/5
    </span>
  );
}

/** The call record as a text file: details, the conversation once Bolna sends it, and every step Closr took. */
export function TranscriptButton({
  call,
  variant = "icon",
}: {
  call: Pick<PastCall, "callRef" | "hasTranscript">;
  variant?: "icon" | "button";
}) {
  const title = call.hasTranscript ? undefined : "The conversation isn't in yet; the file has the call details and every step";
  if (variant === "button") {
    return (
      <a
        href={transcriptUrl(call.callRef)}
        download
        title={title}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-rule bg-sheet px-3 text-[13px] font-semibold text-navy shadow-[0_1px_2px_rgb(19_35_63/0.06)] transition-colors hover:border-sky hover:bg-sky-wash"
      >
        <Download aria-hidden size={15} strokeWidth={2.25} />
        Download transcript
      </a>
    );
  }
  return (
    <a
      href={transcriptUrl(call.callRef)}
      download
      title={title ?? "Download transcript"}
      aria-label={`Download transcript for call ${call.callRef}`}
      className="grid size-8 place-items-center rounded-md border border-rule text-navy transition-colors hover:border-sky hover:bg-sky-wash"
    >
      <Download aria-hidden size={15} strokeWidth={2.25} />
    </a>
  );
}

/** Recent calls for quality review and training, each with its transcript a click away. */
export function CallHistory({ trigger, currentCallRef, now }: Props) {
  const { calls, ratings, loaded, failed } = useCallHistory(trigger);

  const columns: Column<PastCall>[] = [
    {
      header: "Customer",
      cell: (c) => (
        <div className="min-w-0">
          <p className="max-w-[10rem] truncate font-medium text-ink">{c.customerName}</p>
          <p className="figures mt-0.5 whitespace-nowrap text-xs text-muted">{c.phone ? maskIndianMobile(c.phone) : "Number not captured"}</p>
        </div>
      ),
    },
    {
      header: "When",
      cell: (c) => (
        <div className="figures whitespace-nowrap">
          <p>{shortDateTime(c.startedAt)}</p>
          <p className="mt-0.5 text-xs text-muted">
            {c.durationSec !== undefined ? (
              `${duration(c.durationSec * 1000)} talk time`
            ) : LIVE_PHASES.has(c.status) ? (
              <span className="font-semibold text-sky">Live now</span>
            ) : (
              "No talk time"
            )}
          </p>
        </div>
      ),
    },
    {
      header: "Status",
      cell: (c) => (
        <div className="flex flex-col items-start gap-1">
          <StatusPill value={c.status} />
          <RatingMark stars={ratings[c.callRef]} />
        </div>
      ),
    },
    {
      header: "Actions",
      align: "right",
      cell: (c) => <span className="font-semibold text-navy">{c.actions}</span>,
    },
    {
      header: "Record",
      align: "right",
      cell: (c) => (
        <div className="flex justify-end gap-1.5">
          <a
            href={`/diagnostics?call=${encodeURIComponent(c.callRef)}`}
            target="_blank"
            rel="noopener"
            title="Call health: what Closr heard and did, with the recording"
            aria-label={`Call health for call ${c.callRef}`}
            className="grid size-8 place-items-center rounded-md border border-rule text-navy transition-colors hover:border-sky hover:bg-sky-wash"
          >
            <Activity aria-hidden size={15} strokeWidth={2.25} />
          </a>
          <TranscriptButton call={c} />
        </div>
      ),
    },
  ];

  if (!loaded) {
    return <p className="px-5 py-14 text-center text-[14px] text-muted">Loading recent calls…</p>;
  }

  return (
    <div>
      {failed && (
        <p role="status" className="border-b border-rule bg-brick-wash px-5 py-2 text-[13px] font-medium text-brick">
          Couldn&apos;t refresh call history. Showing the last list we had.
        </p>
      )}
      <RecordTable
        rows={calls}
        columns={columns}
        rowKey={(c) => c.callRef}
        matchIds={() => []}
        isCaller={(c) => c.callRef === currentCallRef}
        callerLabel="Current call"
        othersLabel="Earlier calls"
        pulses={{}}
        now={now}
        empty="No calls yet. Every call Closr makes is listed here with its transcript."
        emptyIcon={History}
        minWidth="30rem"
      />
    </div>
  );
}
