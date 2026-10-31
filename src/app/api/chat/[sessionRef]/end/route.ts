import { NextResponse } from "next/server";
import { endChat } from "@/lib/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ sessionRef: string }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const { sessionRef } = await params;
  endChat(sessionRef);
  return NextResponse.json({ ok: true });
}
