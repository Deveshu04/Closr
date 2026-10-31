export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function post<T extends object>(url: string, body: unknown, fallbackError: string): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
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
  }
}

export function startCall(phone?: string): Promise<Result<{ callRef?: string }>> {
  return post("/api/call", phone ? { phone } : {}, "Couldn't start the call");
}

export function decideApproval(id: string, decision: "approved" | "denied"): Promise<Result> {
  return post(`/api/approvals/${encodeURIComponent(id)}`, { decision }, "Couldn't send the decision");
}

/** Served as a text/plain attachment: call details, the conversation and every action Closr took. */
export function transcriptUrl(callRef: string): string {
  return `/api/calls/${encodeURIComponent(callRef)}/transcript`;
}

export function resetDemo(): Promise<Result> {
  return post("/api/reset", {}, "Couldn't reset the demo data");
}
