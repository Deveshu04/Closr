"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PaytmLogo } from "@/components/brand/PaytmLogo";
import type { CallDiagnostics, TimelineEntry } from "@/lib/diagnostics";

interface CallSummary {
  callRef: string;
  customerName: string;
  phone: string;
  status: string;
  startedAt: string;
  durationSec?: number;
}

const LEVEL_STYLES = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warn: "border-amber-300 bg-amber-50 text-amber-900",
  fail: "border-red-300 bg-red-50 text-red-900",
} as const;

const SOURCE_STYLES: Record<TimelineEntry["source"], string> = {
  caller: "bg-sky-100 text-sky-900",
  agent: "bg-indigo-100 text-indigo-900",
  llm: "bg-slate-100 text-slate-700",
  tool: "bg-amber-100 text-amber-900",
  event: "bg-rose-100 text-rose-900",
};

const BUCKET_SEC = 0.1;

/** Root-mean-square loudness per 100 ms for each channel of the recording. */
function loudness(buffer: AudioBuffer): number[][] {
  const size = Math.round(buffer.sampleRate * BUCKET_SEC);
  return Array.from({ length: buffer.numberOfChannels }, (_, channel) => {
    const samples = buffer.getChannelData(channel);
    const buckets: number[] = [];
    for (let i = 0; i < samples.length; i += size) {
      let sum = 0;
      const end = Math.min(i + size, samples.length);
      for (let j = i; j < end; j++) sum += samples[j] * samples[j];
      buckets.push(Math.sqrt(sum / (end - i)));
    }
    return buckets;
  });
}

function LevelGraph({ callRef, windows }: { callRef: string; windows: { from: number; to: number }[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState("Loading recording…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/calls/${callRef}/recording`, { cache: "no-store" });
      if (!res.ok) return setNote("Recording not available yet (Bolna finalises it a few seconds after the call).");
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(await res.arrayBuffer());
      void context.close();
      if (cancelled || !canvas.current) return;
      const channels = loudness(buffer);
      const peak = Math.max(0.0001, ...channels.flat());
      const el = canvas.current;
      const width = (el.width = Math.max(800, channels[0].length * 3));
      const laneHeight = 90;
      const height = (el.height = laneHeight * channels.length);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(99,102,241,0.12)";
      for (const w of windows) ctx.fillRect((w.from / BUCKET_SEC) * 3, 0, ((w.to - w.from) / BUCKET_SEC) * 3, height);
      channels.forEach((buckets, lane) => {
        ctx.fillStyle = lane === 0 ? "#0ea5e9" : "#f97316";
        buckets.forEach((value, i) => {
          const bar = (value / peak) * (laneHeight - 10);
          ctx.fillRect(i * 3, lane * laneHeight + (laneHeight - bar), 2, bar);
        });
      });
      setNote(
        `${buffer.duration.toFixed(1)} s · ${buffer.numberOfChannels} channel${buffer.numberOfChannels > 1 ? "s" : ""} · ` +
          "shaded = when Closr was speaking. Bars outside the shading are other sound on the line, normally the customer.",
      );
    })().catch(() => setNote("Could not decode the recording in this browser."));
    return () => {
      cancelled = true;
    };
  }, [callRef, windows]);

  return (
    <div className="space-y-2">
      <audio controls preload="none" src={`/api/calls/${callRef}/recording`} className="w-full" />
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
        <canvas ref={canvas} height={90} className="h-[90px] min-w-full" />
      </div>
      <p className="text-xs text-slate-500">{note}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium tabular-nums text-slate-900">{value === undefined || value === null || value === "" ? "—" : String(value)}</span>
    </div>
  );
}

export default function DiagnosticsPage() {
  const [calls, setCalls] = useState<CallSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<CallDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCalls = useCallback(async () => {
    const res = await fetch("/api/calls", { cache: "no-store" });
    const body = (await res.json()) as { calls: CallSummary[] };
    setCalls(body.calls);
    const requested = new URLSearchParams(window.location.search).get("call");
    setSelected((current) => current ?? (body.calls.some((c) => c.callRef === requested) ? requested : body.calls[0]?.callRef) ?? null);
  }, []);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  useEffect(() => {
    if (!selected) return;
    setReport(null);
    setError(null);
    fetch(`/api/calls/${selected}/diagnostics`, { cache: "no-store" })
      .then((res) => res.json() as Promise<{ ok: boolean; diagnostics?: CallDiagnostics; error?: string }>)
      .then((body) => (body.ok && body.diagnostics ? setReport(body.diagnostics) : setError(body.error ?? "No diagnostics")))
      .catch(() => setError("Could not load diagnostics"));
  }, [selected]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <PaytmLogo height={22} />
            <span className="h-6 w-px bg-slate-300" aria-hidden />
            <div>
              <h1 className="text-xl font-semibold text-[#002E6E]">Call health</h1>
              <p className="text-sm text-slate-500">Did Closr hear the customer, and what did it do? Straight from the voice platform&apos;s logs.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100">
              Care console
            </Link>
            <button onClick={() => void loadCalls()} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100">
              Refresh calls
            </button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <nav className="space-y-2">
            {calls.length === 0 && <p className="text-sm text-slate-500">No calls yet. Place one from the console.</p>}
            {calls.map((call) => (
              <button
                key={call.callRef}
                onClick={() => setSelected(call.callRef)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${call.callRef === selected ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
              >
                <div className="font-medium">{call.customerName}</div>
                <div className="text-xs text-slate-500">
                  {call.callRef} · {new Date(call.startedAt).toLocaleTimeString("en-IN")} · {call.status}
                </div>
              </button>
            ))}
          </nav>

          <section className="min-w-0 space-y-5">
            {error && <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">{error}</p>}
            {!report && !error && selected && <p className="text-sm text-slate-500">Fetching Bolna debug logs…</p>}
            {report && (
              <>
                <div className={`rounded-xl border p-4 text-sm ${LEVEL_STYLES[report.verdict.level]}`}>{report.verdict.text}</div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <h2 className="mb-2 text-sm font-semibold">What Closr heard</h2>
                    <Fact label="Transcriber events" value={report.heard.transcriberEvents} />
                    <Fact label="Caller utterances" value={report.heard.callerUtterances} />
                    <Fact label="Caller speaking (VAD)" value={report.heard.callerSpeakingMs === null ? null : `${report.heard.callerSpeakingMs} ms`} />
                    <Fact label="Agent lines" value={report.agent.utterances} />
                    <Fact label="LLM turns" value={report.llmTurns} />
                    <Fact label="Tool calls" value={report.toolCalls} />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <h2 className="mb-2 text-sm font-semibold">Phone line</h2>
                    <Fact label="Carrier" value={report.line.carrier} />
                    <Fact label="Ring" value={report.line.ringSec === undefined ? null : `${report.line.ringSec} s`} />
                    <Fact label="First audio" value={report.line.timeToFirstAudioSec === undefined ? null : `${report.line.timeToFirstAudioSec} s`} />
                    <Fact label="Hung up by" value={report.line.hangupBy} />
                    <Fact label="Hang-up reason" value={report.line.hangupReason} />
                    <Fact label="Termination" value={report.line.terminationReason} />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <h2 className="mb-2 text-sm font-semibold">Speech-to-text and VAD</h2>
                    {Object.entries(report.stt).map(([key, value]) => (
                      <Fact key={key} label={key} value={value} />
                    ))}
                  </div>
                </div>

                {report.hasRecording && selected && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <h2 className="mb-2 text-sm font-semibold">Recording and audio level</h2>
                    <LevelGraph callRef={selected} windows={report.agent.speakingWindows} />
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h2 className="mb-3 text-sm font-semibold">Timeline (seconds after pick-up)</h2>
                  <ol className="space-y-1.5">
                    {report.timeline.map((entry, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="w-14 shrink-0 text-right tabular-nums text-slate-500">{entry.at.toFixed(1)}s</span>
                        <span className={`w-16 shrink-0 rounded px-1.5 text-center text-xs leading-5 ${SOURCE_STYLES[entry.source]}`}>{entry.source}</span>
                        <span className="min-w-0 break-words">
                          {entry.text}
                          {entry.latencyMs !== undefined && <span className="ml-2 text-xs text-slate-400">{entry.latencyMs} ms</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
