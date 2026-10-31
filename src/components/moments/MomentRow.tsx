"use client";

import { motion } from "motion/react";
import type { Moment, MomentKind, MomentStatus } from "@/lib/types";
import type { ApprovalControls } from "../hooks/useApprovals";
import { clockTime, duration } from "../lib/format";
import { ActionMoment } from "./ActionMoment";
import { ApprovalMoment } from "./ApprovalMoment";
import { CallLine } from "./CallLine";
import { EscalatedMoment } from "./EscalatedMoment";
import { LookupMoment } from "./LookupMoment";
import { PolicyMoment } from "./PolicyMoment";
import { SearchMoment } from "./SearchMoment";
import { UnderstoodMoment } from "./UnderstoodMoment";
import { VerifiedMoment } from "./VerifiedMoment";
import { KIND_META, isTrouble } from "./shared";

/** Gutter width + gap + half the node column; the timeline's spine is drawn at this offset. */
export const SPINE_LEFT = "calc(3.25rem + 0.75rem + 1rem)";

const OK_NODE: Partial<Record<MomentKind, string>> = {
  action: "border-navy bg-navy text-white",
  verified: "border-leaf bg-leaf text-white",
  approval: "border-amber-bright bg-amber-bright text-white",
  understood: "border-sky/50 bg-sky-wash text-navy",
};

const VERDICT_NODE: Record<string, string> = {
  supported: "border-leaf bg-leaf text-white",
  not_found: "border-amber-bright bg-amber-wash text-amber",
  contradicted: "border-brick bg-brick text-white",
};

function nodeClass(kind: MomentKind, status: MomentStatus, verdict: unknown): string {
  if (status === "running") return "node-spin border-sky/40 bg-sheet text-sky";
  if (kind === "search" && typeof verdict === "string" && Object.hasOwn(VERDICT_NODE, verdict)) return VERDICT_NODE[verdict];
  if (status === "waiting") return "is-waiting border-amber-bright bg-amber-bright text-white";
  if (isTrouble(status)) return "border-brick/50 bg-brick-wash text-brick";
  return OK_NODE[kind] ?? "border-navy/25 bg-sheet text-navy";
}

function Node({ moment, latest }: { moment: Moment; latest: boolean }) {
  if (moment.kind === "call") {
    return (
      <span
        aria-hidden
        className={`relative z-10 mt-2 size-2.5 rounded-full ring-4 ring-paper ${isTrouble(moment.status) ? "bg-brick" : "bg-navy/40"}`}
      />
    );
  }
  const Icon = KIND_META[moment.kind].icon;
  return (
    <span
      title={KIND_META[moment.kind].label}
      className={`relative z-10 grid size-8 place-items-center rounded-full border-[1.5px] ${nodeClass(moment.kind, moment.status, moment.data?.verdict)} ${
        latest ? "outline-4 outline-sky/25" : ""
      }`}
    >
      <Icon aria-hidden size={16} strokeWidth={2.25} />
      <span className="sr-only">{KIND_META[moment.kind].label}</span>
    </span>
  );
}

function Body({ moment, controls }: { moment: Moment; controls: ApprovalControls }) {
  switch (moment.kind) {
    case "call":
      return <CallLine moment={moment} />;
    case "understood":
      return <UnderstoodMoment moment={moment} />;
    case "lookup":
      return <LookupMoment moment={moment} />;
    case "policy":
      return <PolicyMoment moment={moment} />;
    case "action":
      return <ActionMoment moment={moment} />;
    case "verified":
      return <VerifiedMoment moment={moment} />;
    case "approval":
      return <ApprovalMoment moment={moment} controls={controls} />;
    case "search":
      return <SearchMoment moment={moment} />;
    case "escalated":
      return <EscalatedMoment moment={moment} />;
    default:
      return <CallLine moment={moment} />;
  }
}

interface Props {
  moment: Moment;
  offsetMs: number;
  latest: boolean;
  controls: ApprovalControls;
}

export function MomentRow({ moment, offsetMs, latest, controls }: Props) {
  const compact = moment.kind === "call";
  return (
    <motion.li
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      className={`grid grid-cols-[3.25rem_2rem_minmax(0,1fr)] gap-x-3 ${compact ? "pb-4" : "pb-6"}`}
    >
      <time
        dateTime={moment.at}
        title={clockTime(moment.at)}
        className={`figures text-right text-[13px] text-faint ${compact ? "pt-1" : "pt-1.5"}`}
      >
        +{duration(offsetMs)}
      </time>
      <div className="flex justify-center">
        <Node moment={moment} latest={latest} />
      </div>
      <div className="min-w-0">
        <Body moment={moment} controls={controls} />
      </div>
    </motion.li>
  );
}
