import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { mapBolnaStatus } from "@/lib/bolna";
import { findCallByExecutionId, getCall, recordMoment, updateCall } from "@/lib/db";

export const dynamic = "force-dynamic";

interface BolnaExecution {
  id?: string;
  status?: string;
  transcript?: string;
  summary?: string;
  conversation_duration?: number;
  context_details?: { recipient_data?: { call_ref?: string } };
}

export async function POST(req: Request) {
  const secret = Buffer.from(process.env.WEBHOOK_SECRET ?? "");
  const presented = Buffer.from(new URL(req.url).searchParams.get("key") ?? "");
  if (!secret.length || presented.length !== secret.length || !timingSafeEqual(presented, secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const payload = (await req.json().catch(() => ({}))) as BolnaExecution;
  const refFromBolna = payload.context_details?.recipient_data?.call_ref;
  const call = (refFromBolna && getCall(refFromBolna)) || (payload.id && findCallByExecutionId(payload.id));
  if (!call) return NextResponse.json({ ok: true, ignored: true });

  const { callRef, status: previous } = call;
  const status = mapBolnaStatus(payload.status);
  const finished = status === "completed" || status === "failed";
  // Bolna posts call-disconnected and then completed (and may retry), so the first final event fixes
  // the end time and nothing after it may reopen or extend the call.
  const alreadyOver = previous === "completed" || previous === "failed";

  updateCall(callRef, {
    ...(status && !alreadyOver && { status }),
    ...(payload.transcript && { transcript: payload.transcript }),
    ...(payload.summary && { summary: payload.summary }),
    ...(payload.conversation_duration && { durationSec: Math.round(payload.conversation_duration) }),
    ...(finished && !alreadyOver && { endedAt: new Date().toISOString() }),
  });

  if (status === "in_progress" && previous !== "in_progress" && !alreadyOver) {
    recordMoment({ callRef, kind: "call", title: "Customer picked up", status: "ok" });
  }
  if (finished && !alreadyOver) {
    recordMoment({
      callRef,
      kind: "call",
      title: status === "failed" ? `Call ended: ${payload.status}` : "Call ended",
      status: status === "failed" ? "failed" : "ok",
    });
  }

  return NextResponse.json({ ok: true });
}
