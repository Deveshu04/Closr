import { NextResponse } from "next/server";
import { resolveApproval } from "@/lib/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DECISIONS: Record<string, "approved" | "denied"> = {
  approved: "approved",
  approve: "approved",
  denied: "denied",
  deny: "denied",
  rejected: "denied",
  reject: "denied",
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { decision?: unknown };
  const decision = typeof body.decision === "string" ? DECISIONS[body.decision.toLowerCase()] : undefined;
  if (!decision) {
    return NextResponse.json({ ok: false, error: 'decision must be "approved" or "denied"' }, { status: 400 });
  }

  const approval = await resolveApproval(id, decision);
  if (!approval) return NextResponse.json({ ok: false, error: "Approval not found" }, { status: 404 });
  return NextResponse.json({ ok: true, approval });
}
