import { NextResponse } from "next/server";
import { chatTurn } from "@/lib/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MESSAGE_LENGTH = 500;

interface RouteContext {
  params: Promise<{ sessionRef: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const { sessionRef } = await params;
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return NextResponse.json({ ok: false, error: "Type a message first" }, { status: 400 });

  try {
    return NextResponse.json({ ok: true, ...(await chatTurn(sessionRef, text)) });
  } catch (error) {
    console.error("[chat]", error);
    const message = error instanceof Error ? error.message : "Closr couldn't reply";
    return NextResponse.json({ ok: false, error: message }, { status: message === "This chat has ended" ? 409 : 502 });
  }
}
