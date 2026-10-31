import { NextResponse } from "next/server";
import { getCustomer, listCalls, listMoments } from "@/lib/db";
import { callDurationSec } from "@/lib/transcript";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const calls = listCalls().map((call) => ({
    callRef: call.callRef,
    customerName: (call.customerId && getCustomer(call.customerId)?.name) || "Unidentified caller",
    phone: call.phone,
    status: call.status,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    durationSec: callDurationSec(call),
    hasTranscript: Boolean(call.transcript),
    actions: listMoments(call.callRef).filter((moment) => moment.kind !== "call").length,
  }));
  return NextResponse.json({ calls }, { headers: { "Cache-Control": "no-store" } });
}
