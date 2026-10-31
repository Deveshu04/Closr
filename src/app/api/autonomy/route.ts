import { NextResponse } from "next/server";
import { setAutonomy } from "@/lib/db";
import type { AutonomyLevel, Workflow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKFLOWS: Workflow[] = ["cashback", "rent_refunds", "settlement_retries"];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { workflow?: string; level?: number };
  const workflow = WORKFLOWS.find((name) => name === body.workflow);
  if (!workflow) return NextResponse.json({ ok: false, error: "Unknown workflow" }, { status: 400 });
  if (body.level !== 0 && body.level !== 1 && body.level !== 2 && body.level !== 3) {
    return NextResponse.json({ ok: false, error: "Level must be 0, 1, 2 or 3" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, autonomy: setAutonomy(workflow, body.level as AutonomyLevel) });
}
