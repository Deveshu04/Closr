import { NextResponse } from "next/server";
import { fetchAgentTranscriber, fetchDebugBundle } from "@/lib/bolna";
import { getCall } from "@/lib/db";
import { diagnose } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ callRef: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { callRef } = await params;
  const call = getCall(callRef);
  if (!call?.bolnaExecutionId) {
    return NextResponse.json({ ok: false, error: "This call has no Bolna execution to inspect" }, { status: 404 });
  }
  const [bundle, stt] = await Promise.all([
    fetchDebugBundle(call.bolnaExecutionId).catch(() => null),
    fetchAgentTranscriber().catch(() => null),
  ]);
  if (!bundle) {
    return NextResponse.json({ ok: false, error: "Bolna has no debug data for this call yet" }, { status: 502 });
  }
  return NextResponse.json(
    { ok: true, call, diagnostics: diagnose(call.bolnaExecutionId, bundle, stt ?? {}) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
