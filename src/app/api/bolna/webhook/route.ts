import { NextResponse } from "next/server";
import { mapBolnaStatus } from "@/lib/bolna";
import { findCallByExecutionId, getCall, recordMoment, updateCall } from "@/lib/db";

export const dynamic = "force-dynamic";

interface BolnaExecution {
  id?: string;
  status?: string;
  transcript?: string;
  summary?: string;
  context_details?: { recipient_data?: { call_ref?: string } };
}

export async function POST(req: Request) {
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && new URL(req.url).searchParams.get("key") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const payload = (await req.json().catch(() => ({}))) as BolnaExecution;
  const refFromBolna = payload.context_details?.recipient_data?.call_ref;
  const call = (refFromBolna && getCall(refFromBolna)) || (payload.id && findCallByExecutionId(payload.id));
  if (!call) return NextResponse.json({ ok: true, ignored: true });

  const { callRef, status: previous } = call;
  const status = mapBolnaStatus(payload.status);
  const finished = status === "completed" || status === "failed";

  updateCall(callRef, {
    ...(status && { status }),
    ...(payload.transcript && { transcript: payload.transcript }),
    ...(payload.summary && { summary: payload.summary }),
    ...(finished && { endedAt: new Date().toISOString() }),
  });

  if (status === "in_progress" && previous !== "in_progress") {
    recordMoment({ callRef, kind: "call", title: "Customer picked up", status: "ok" });
  }
  // Bolna posts both call-disconnected and completed; only the first transition into a final state is shown.
  if (finished && previous !== "completed" && previous !== "failed") {
    recordMoment({
      callRef,
      kind: "call",
      title: status === "failed" ? `Call ended: ${payload.status}` : "Call ended",
      status: status === "failed" ? "failed" : "ok",
    });
  }

  return NextResponse.json({ ok: true });
}
