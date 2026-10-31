import { NextResponse } from "next/server";
import { addLesson } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_LESSON_LENGTH = 300;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: string; sourceCallRef?: string };
  const text = (body.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LESSON_LENGTH);
  if (!text) return NextResponse.json({ ok: false, error: "Write what Closr should do next time" }, { status: 400 });
  return NextResponse.json({ ok: true, lesson: addLesson(text, body.sourceCallRef) });
}
