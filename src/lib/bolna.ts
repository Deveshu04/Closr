const BOLNA_API = "https://api.bolna.ai";

function bolnaHeaders(): HeadersInit {
  const key = process.env.BOLNA_API_KEY;
  if (!key) throw new Error("BOLNA_API_KEY is not set");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

export async function placeCall(
  phone: string,
  userData: Record<string, string>,
): Promise<{ executionId: string }> {
  const agentId = process.env.BOLNA_AGENT_ID;
  if (!agentId) throw new Error("BOLNA_AGENT_ID is not set");

  const res = await fetch(`${BOLNA_API}/call`, {
    method: "POST",
    headers: bolnaHeaders(),
    body: JSON.stringify({
      agent_id: agentId,
      recipient_phone_number: phone,
      user_data: userData,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { execution_id?: string; message?: string };
  if (!res.ok || !body.execution_id) {
    throw new Error(body.message ?? `Bolna call failed with ${res.status}`);
  }
  return { executionId: body.execution_id };
}

const STATUS_MAP: Record<string, "dialing" | "ringing" | "in_progress" | "completed" | "failed"> = {
  queued: "dialing",
  scheduled: "dialing",
  initiated: "dialing",
  ringing: "ringing",
  "in-progress": "in_progress",
  "call-disconnected": "completed",
  completed: "completed",
  "no-answer": "failed",
  busy: "failed",
  failed: "failed",
  canceled: "failed",
  stopped: "completed",
  error: "failed",
  "balance-low": "failed",
};

export function mapBolnaStatus(status: string | undefined) {
  return status ? STATUS_MAP[status] : undefined;
}
