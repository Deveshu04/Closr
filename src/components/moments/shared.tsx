import {
  AudioLines,
  BadgeCheck,
  BookCheck,
  Database,
  Hand,
  Headset,
  LoaderCircle,
  type LucideIcon,
  PhoneCall,
  ScrollText,
  Stamp,
} from "lucide-react";
import type { MomentKind, MomentStatus } from "@/lib/types";
import type { Field } from "../lib/data";

export const KIND_META: Record<MomentKind, { label: string; icon: LucideIcon; hint: string }> = {
  call: { label: "Call", icon: PhoneCall, hint: "The call starting or ending" },
  understood: { label: "Understood", icon: AudioLines, hint: "What it heard the customer ask for" },
  lookup: { label: "Lookup", icon: Database, hint: "A record it pulled from UPI, Settlements, Soundbox and more" },
  policy: { label: "Policy check", icon: ScrollText, hint: "Each rule it checked before acting" },
  action: { label: "Action", icon: Stamp, hint: "Something it actually did, with the record id" },
  verified: { label: "Verified", icon: BadgeCheck, hint: "The result, re-read from the source system" },
  approval: { label: "Approval", icon: Hand, hint: "Over its limit, so a Paytm specialist decides in one tap" },
  search: { label: "Claim check", icon: BookCheck, hint: "A rule the customer cited, checked against RBI and NPCI" },
  escalated: { label: "Handoff", icon: Headset, hint: "Passed to a human specialist with a written brief" },
};

export function isTrouble(status: MomentStatus): boolean {
  return status === "blocked" || status === "failed";
}

/** Surface classes for the boxed moment kinds; each kind adds its own base look on top. */
export function surfaceFor(status: MomentStatus): string {
  if (status === "running") return "is-running";
  if (status === "waiting") return "is-waiting";
  if (isTrouble(status)) return "border-brick/40! bg-brick-wash!";
  return "";
}

const NOTE: Partial<Record<MomentStatus, string>> = {
  running: "Working",
  waiting: "Waiting",
  blocked: "Blocked",
  failed: "Failed",
};

export function StatusNote({ status, className = "" }: { status: MomentStatus; className?: string }) {
  const label = NOTE[status];
  if (!label) return null;
  const tone =
    status === "running" ? "text-sky" : status === "waiting" ? "text-amber" : "text-brick";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold ${tone} ${className}`}>
      {status === "running" && <LoaderCircle aria-hidden size={14} className="animate-spin motion-reduce:animate-none" />}
      {label}
    </span>
  );
}

export function FieldGrid({
  fields,
  tone = "light",
  className = "mt-3",
}: {
  fields: Field[];
  tone?: "light" | "dark";
  className?: string;
}) {
  if (fields.length === 0) return null;
  const label = tone === "dark" ? "text-white/60" : "text-muted";
  const value = tone === "dark" ? "text-white" : "text-ink";
  return (
    <dl className={`grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-6 gap-y-2.5 ${className}`}>
      {fields.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className={`text-xs ${label}`}>{f.label}</dt>
          <dd
            title={f.full ? `${f.label} ${f.full}` : undefined}
            className={`figures break-words text-[15px] font-medium leading-snug ${value} ${f.full ? "cursor-help" : ""}`}
          >
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
