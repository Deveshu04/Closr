import { NextResponse } from "next/server";
import { startChat } from "@/lib/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { profile?: string };
  try {
    return NextResponse.json({ ok: true, ...startChat(body.profile === "merchant" ? "merchant" : "consumer") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't start the chat";
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}
