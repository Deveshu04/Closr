import { NextResponse } from "next/server";
import { fetchDebugBundle, fetchRecording } from "@/lib/bolna";
import { getCall } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ callRef: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { callRef } = await params;
  const call = getCall(callRef);
  const bundle = call?.bolnaExecutionId ? await fetchDebugBundle(call.bolnaExecutionId).catch(() => null) : null;
  const url = bundle?.execution?.telephony_data?.recording_url;
  const upstream = url ? await fetchRecording(url)?.catch(() => null) : null;
  if (!upstream?.ok || !upstream.body) {
    return NextResponse.json({ ok: false, error: "Recording not available" }, { status: 404 });
  }
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/wav",
      "Cache-Control": "no-store",
    },
  });
}
