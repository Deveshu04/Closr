import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { unwrapToolParams, type ToolParams } from "@/lib/tool-input";
import { isToolName, runTool } from "@/lib/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ tool: string }>;
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.TOOLS_SECRET;
  if (!secret) return false;
  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(secret);
  const actual = Buffer.from(presented);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

async function handle(request: Request, context: RouteContext, body: unknown): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, say: "Unauthorized." }, { status: 401 });
  }
  const { tool } = await context.params;
  if (!isToolName(tool)) {
    return NextResponse.json({ ok: false, say: `There is no tool called ${tool}.` }, { status: 404 });
  }

  const query: ToolParams = Object.fromEntries(new URL(request.url).searchParams);
  const params = { ...query, ...unwrapToolParams(body) };
  try {
    return NextResponse.json(await runTool(tool, params));
  } catch (error) {
    console.error(`[tools/${tool}]`, error);
    // A 200 with a speakable message lets the voice agent apologise and carry on instead of stalling.
    return NextResponse.json({
      ok: false,
      say: "Something went wrong on my side while checking that. Let me try another way, or I can connect you to a teammate.",
    });
  }
}

export async function POST(request: Request, context: RouteContext) {
  return handle(request, context, await readBody(request));
}
