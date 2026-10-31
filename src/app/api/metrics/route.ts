import { NextResponse } from "next/server";
import { computeMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(computeMetrics(), { headers: { "Cache-Control": "no-store" } });
}
