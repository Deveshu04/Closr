import { NextResponse } from "next/server";
import { deleteLesson } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  return NextResponse.json({ ok: deleteLesson(id) });
}
