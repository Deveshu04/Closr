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

export interface BolnaExecutionRecord {
  status?: string;
  transcript?: string;
  conversation_duration?: number;
}

export async function fetchExecution(executionId: string): Promise<BolnaExecutionRecord | null> {
  const res = await fetch(`${BOLNA_API}/executions/${executionId}`, { headers: bolnaHeaders() });
  return res.ok ? ((await res.json()) as BolnaExecutionRecord) : null;
}

export interface BolnaLogEntry {
  created_at: string;
  component: string;
  type: string;
  provider?: string;
  data?: unknown;
  latency?: number;
}

export interface BolnaDebugBundle {
  execution?: {
    status?: string;
    termination_reason?: string;
    telephony_data?: {
      to_number_carrier?: string;
      ring_duration?: number;
      hangup_by?: string;
      hangup_reason?: string;
      recording_url?: string;
    };
    latency_data?: {
      time_to_first_audio?: number;
      interruption_stats?: { user_speaking_ms?: number; agent_speaking_ms?: number };
    };
    usage_breakdown?: {
      transcriber_provider?: string;
      transcriber_model?: string;
      transcriber_language?: string;
      transcriber_duration?: number;
      endpointing?: number;
      incremental_delay?: number;
      hangup_after_silence?: number;
    };
  };
  progression?: {
    call_start_at?: string;
    transcript?: { kind: string; role?: string; text?: string; ts?: string; label?: string }[];
  };
  logs?: BolnaLogEntry[];
}

/** Bolna's one-request debug view: execution, per-turn progression and the transcriber/LLM/synthesizer logs. */
export async function fetchDebugBundle(executionId: string): Promise<BolnaDebugBundle | null> {
  const res = await fetch(`${BOLNA_API}/executions/${executionId}/debug`, { headers: bolnaHeaders() });
  return res.ok ? ((await res.json()) as BolnaDebugBundle) : null;
}

export async function fetchAgentTranscriber(): Promise<Record<string, unknown> | null> {
  const agentId = process.env.BOLNA_AGENT_ID;
  if (!agentId) return null;
  const res = await fetch(`${BOLNA_API}/v2/agent/${agentId}`, { headers: bolnaHeaders() });
  if (!res.ok) return null;
  const agent = (await res.json()) as { tasks?: { tools_config?: { transcriber?: Record<string, unknown> } }[] };
  return agent.tasks?.[0]?.tools_config?.transcriber ?? null;
}

/** Only Bolna-hosted recordings are fetched, since the request carries our API key. */
export function fetchRecording(recordingUrl: string): Promise<Response> | null {
  if (new URL(recordingUrl).hostname !== new URL(BOLNA_API).hostname) return null;
  const { Authorization } = bolnaHeaders() as Record<string, string>;
  return fetch(recordingUrl, { headers: { Authorization } });
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
