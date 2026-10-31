import { NextResponse } from "next/server";
import { resetDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { clearHistory?: boolean };
  resetDb({ keepHistory: body.clearHistory !== true });
  return NextResponse.json({ ok: true });
}
