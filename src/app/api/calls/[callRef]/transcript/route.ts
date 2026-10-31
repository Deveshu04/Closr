import { NextResponse } from "next/server";
import { fetchExecution } from "@/lib/bolna";
import { getCall, getCustomer, getState, listMoments, updateCall } from "@/lib/db";
import { renderTranscript } from "@/lib/transcript";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ callRef: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { callRef } = await params;
  let call = getCall(callRef);
  if (!call) return NextResponse.json({ ok: false, error: "Unknown call" }, { status: 404 });

  // If the end-of-call webhook never landed (tunnel down, replay), the transcript can still be pulled from Bolna.
  if (!call.transcript && call.bolnaExecutionId) {
    const execution = await fetchExecution(call.bolnaExecutionId).catch(() => null);
    if (execution?.transcript) {
      call = updateCall(callRef, { transcript: execution.transcript }) ?? call;
    }
  }

  const approvals = getState().approvals.filter((approval) => approval.callRef === callRef);
  const body = renderTranscript(call, call.customerId ? getCustomer(call.customerId) : null, listMoments(callRef), approvals);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="closr-${callRef}.txt"`,
      "Cache-Control": "no-store",
    },
  });
}
