import type { BolnaDebugBundle } from "./bolna";

export interface TimelineEntry {
  /** Seconds since the call was answered. */
  at: number;
  source: "caller" | "agent" | "llm" | "tool" | "event";
  text: string;
  latencyMs?: number;
}

export interface CallDiagnostics {
  executionId: string;
  verdict: { level: "ok" | "warn" | "fail"; text: string };
  heard: { transcriberEvents: number; callerUtterances: number; callerSpeakingMs: number | null };
  agent: { utterances: number; speakingWindows: { from: number; to: number }[] };
  llmTurns: number;
  toolCalls: number;
  line: {
    carrier?: string;
    ringSec?: number;
    hangupBy?: string;
    hangupReason?: string;
    terminationReason?: string;
    timeToFirstAudioSec?: number;
  };
  stt: Record<string, unknown>;
  timeline: TimelineEntry[];
  hasRecording: boolean;
}

// Synthesizer logs mark when the agent's audio was produced; each line is assumed to play at ~13 characters a second,
// close enough to shade the agent's own speech on the recording graph.
const SPOKEN_CHARS_PER_SECOND = 13;

function secondsSince(start: number, iso: string): number {
  const ms = Date.parse(iso.includes("T") || iso.endsWith("Z") ? iso : `${iso.replace(" ", "T")}Z`);
  return Math.max(0, Math.round((ms - start) / 100) / 10);
}

function textOf(data: unknown): string {
  if (typeof data === "string") return data;
  return JSON.stringify(data ?? "").slice(0, 240);
}

export function diagnose(executionId: string, bundle: BolnaDebugBundle, sttConfig: Record<string, unknown>): CallDiagnostics {
  const execution = bundle.execution ?? {};
  const logs = bundle.logs ?? [];
  const startIso = bundle.progression?.call_start_at ?? logs[0]?.created_at ?? new Date().toISOString();
  const start = Date.parse(startIso);

  const timeline: TimelineEntry[] = [];
  const speakingWindows: { from: number; to: number }[] = [];
  let transcriberEvents = 0;
  let llmTurns = 0;
  let toolCalls = 0;

  for (const log of logs) {
    const at = secondsSince(start, log.created_at);
    if (log.component === "transcriber") {
      transcriberEvents += 1;
      timeline.push({ at, source: "caller", text: textOf(log.data), latencyMs: log.latency ? Math.round(log.latency * 1000) : undefined });
    } else if (log.component === "synthesizer" && log.type === "response") {
      const text = textOf(log.data);
      speakingWindows.push({ from: at, to: at + text.length / SPOKEN_CHARS_PER_SECOND });
      timeline.push({ at, source: "agent", text });
    } else if (log.component === "llm" && log.type === "response") {
      llmTurns += 1;
      timeline.push({ at, source: "llm", text: textOf(log.data) });
    } else if (log.component === "function_call" && log.type === "request") {
      toolCalls += 1;
      timeline.push({ at, source: "tool", text: textOf(log.data) });
    }
  }
  for (const item of bundle.progression?.transcript ?? []) {
    if (item.kind === "event" && item.ts && item.label) {
      timeline.push({ at: secondsSince(start, item.ts), source: "event", text: item.label });
    }
  }
  timeline.sort((a, b) => a.at - b.at);

  const callerUtterances = (bundle.progression?.transcript ?? []).filter((item) => item.role === "user").length;
  const callerSpeakingMs = execution.latency_data?.interruption_stats?.user_speaking_ms ?? null;
  const usage = execution.usage_breakdown ?? {};

  const verdict: CallDiagnostics["verdict"] =
    transcriberEvents === 0
      ? {
          level: "fail",
          text:
            "No caller audio reached speech-to-text: the transcriber produced nothing for the whole call. " +
            "If the recording below shows the customer's voice, the audio reached Bolna but was not transcribed; if it is flat, the line never carried it.",
        }
      : llmTurns === 0
        ? { level: "warn", text: "The customer was transcribed but the agent never replied: check the LLM logs in the timeline." }
        : { level: "ok", text: `Heard the customer ${transcriberEvents} times and replied ${llmTurns} times.` };

  return {
    executionId,
    verdict,
    heard: { transcriberEvents, callerUtterances, callerSpeakingMs },
    agent: { utterances: speakingWindows.length, speakingWindows },
    llmTurns,
    toolCalls,
    line: {
      carrier: execution.telephony_data?.to_number_carrier,
      ringSec: execution.telephony_data?.ring_duration,
      hangupBy: execution.telephony_data?.hangup_by,
      hangupReason: execution.telephony_data?.hangup_reason,
      terminationReason: execution.termination_reason,
      timeToFirstAudioSec: execution.latency_data?.time_to_first_audio,
    },
    stt: {
      provider: usage.transcriber_provider,
      model: usage.transcriber_model,
      language: usage.transcriber_language,
      listenedSec: usage.transcriber_duration,
      endpointingMs: usage.endpointing,
      incrementalDelayMs: usage.incremental_delay,
      hangupAfterSilenceSec: usage.hangup_after_silence,
      vadThreshold: sttConfig.vad_threshold,
      vadPrefixPaddingMs: sttConfig.vad_prefix_padding_ms,
      noiseReduction: sttConfig.noise_reduction,
      samplingRate: sttConfig.sampling_rate,
      encoding: sttConfig.encoding,
    },
    timeline,
    hasRecording: Boolean(execution.telephony_data?.recording_url),
  };
}
