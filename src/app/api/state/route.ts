import { NextResponse } from "next/server";
import { getState } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(getState(), { headers: { "Cache-Control": "no-store" } });
}
