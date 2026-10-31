import { NextResponse } from "next/server";
import { runDueFollowUps } from "@/lib/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({ ok: true, ran: await runDueFollowUps() });
}
