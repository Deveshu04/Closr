import type { Approval, CallRecord, Customer, Moment } from "./types";

const SPEAKERS: Record<string, string> = { assistant: "Closr", user: "Customer", agent: "Closr", human: "Customer" };

function clock(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" });
}

function offset(fromIso: string, iso: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(iso) - Date.parse(fromIso)) / 1000));
  return `+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function callDurationSec(call: CallRecord): number | undefined {
  if (call.durationSec) return call.durationSec;
  if (!call.endedAt) return undefined;
  return Math.max(0, Math.round((Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000));
}

function conversationLines(transcript: string): string[] {
  return transcript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(\w+):\s*(.*)$/.exec(line);
      const speaker = match && SPEAKERS[match[1].toLowerCase()];
      return speaker ? `${speaker.padEnd(9)}${match[2]}` : line;
    });
}

export function renderTranscript(
  call: CallRecord,
  customer: Customer | null,
  moments: Moment[],
  approvals: Approval[],
): string {
  const duration = callDurationSec(call);
  const lines = [
    "CLOSR · PAYTM CARE — CALL RECORD",
    "For quality review and internal training. Contains customer data: handle per policy.",
    "",
    `Call        ${call.callRef}`,
    `Customer    ${customer ? `${customer.name} (${customer.id})` : "Unidentified"}`,
    `Phone       ${call.phone}`,
    `Started     ${clock(call.startedAt)} IST`,
    `Ended       ${call.endedAt ? `${clock(call.endedAt)} IST` : "—"}`,
    `Duration    ${duration === undefined ? "—" : `${Math.floor(duration / 60)}m ${duration % 60}s`}`,
    `Status      ${call.status}`,
    ...(call.bolnaExecutionId ? [`Bolna run   ${call.bolnaExecutionId}`] : []),
    "",
    "CONVERSATION",
    "",
    ...(call.transcript
      ? conversationLines(call.transcript)
      : ["(The conversation text is not available yet. Bolna sends it a few seconds after the call ends.)"]),
    "",
    "ACTIONS CLOSR TOOK",
    "",
    ...(moments.length
      ? moments.map((moment) =>
          [
            `${offset(call.startedAt, moment.at).padEnd(7)}${moment.kind.toUpperCase().padEnd(11)}${moment.status.padEnd(9)}${moment.title}`,
            ...(moment.detail ? [`${" ".repeat(27)}${moment.detail}`] : []),
          ].join("\n"),
        )
      : ["(none)"]),
  ];

  if (approvals.length) {
    lines.push("", "HUMAN APPROVALS", "");
    for (const approval of approvals) {
      const decided = approval.decidedAt ? ` at ${clock(approval.decidedAt)} IST` : "";
      lines.push(`${approval.id}  ₹${approval.amount.toLocaleString("en-IN")}  ${approval.status}${decided}  — ${approval.reason}`);
    }
  }
  if (call.summary) lines.push("", "SUMMARY", "", call.summary);
  return `${lines.join("\n")}\n`;
}
