import { NextResponse } from "next/server";
import { resetDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST() {
  resetDb();
  return NextResponse.json({ ok: true });
}
