import type { ProfileKind } from "@/lib/types";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function post<T extends object>(
  url: string,
  body: unknown,
  fallbackError: string,
  timeoutMs?: number,
): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      signal: controller.signal,
    });
    const json: unknown = await res.json().catch(() => null);
    const record = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
    const error = typeof record.error === "string" ? record.error : undefined;
    if (!res.ok || record.ok === false) {
      return { ok: false, error: error ?? `${fallbackError} (${res.status})` };
    }
    return { ok: true, ...(record as T) };
  } catch {
    return { ok: false, error: `${fallbackError}: the console server didn't answer` };
  } finally {
    clearTimeout(timer);
  }
}

export function startCall(phone: string, profile: ProfileKind): Promise<Result<{ callRef?: string }>> {
  return post("/api/call", { phone, profile }, "Couldn't start the call");
}

export interface ChatReply {
  reply: string;
  suggestions: string[];
  ended: boolean;
}

function chatReply(raw: Record<string, unknown>): ChatReply {
  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim())
    : [];
  return { reply: typeof raw.reply === "string" ? raw.reply.trim() : "", suggestions, ended: raw.ended === true };
}

/** Opens a chat for the signed-in app profile; it becomes the console's active session. */
export async function startChat(profile: ProfileKind): Promise<Result<ChatReply & { sessionRef: string }>> {
  // Generous: a timed-out start can still open the session on the server, and that would block the next try.
  const result = await post<Record<string, unknown>>("/api/chat/start", { profile }, "Couldn't start the chat", 60_000);
  if (!result.ok) return result;
  const sessionRef = typeof result.sessionRef === "string" ? result.sessionRef : "";
  if (!sessionRef) return { ok: false, error: "Couldn't start the chat: no session came back" };
  return { ok: true, sessionRef, ...chatReply(result) };
}

/** Closr may run several tools and wait for a specialist's approval before answering, so this allows a long wait. */
export async function sendChatMessage(sessionRef: string, text: string): Promise<Result<ChatReply>> {
  const result = await post<Record<string, unknown>>(
    `/api/chat/${encodeURIComponent(sessionRef)}/messages`,
    { text },
    "Your message didn't reach Closr",
    60_000,
  );
  return result.ok ? { ok: true, ...chatReply(result) } : result;
}

export function endChat(sessionRef: string): Promise<Result> {
  return post(`/api/chat/${encodeURIComponent(sessionRef)}/end`, {}, "Couldn't end the chat", 10_000);
}

export function decideApproval(id: string, decision: "approved" | "denied"): Promise<Result> {
  return post(`/api/approvals/${encodeURIComponent(id)}`, { decision }, "Couldn't send the decision");
}

/** Served as a text/plain attachment: call details, the conversation and every action Closr took. */
export function transcriptUrl(callRef: string): string {
  return `/api/calls/${encodeURIComponent(callRef)}/transcript`;
}

/** Puts every record back to its seeded state; call history and transcripts survive unless `clearHistory`. */
export function resetDemo({ clearHistory = false }: { clearHistory?: boolean } = {}): Promise<Result> {
  return post("/api/reset", { clearHistory }, "Couldn't reset the demo data");
}
