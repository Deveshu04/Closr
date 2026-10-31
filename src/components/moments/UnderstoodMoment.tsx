import type { Moment } from "@/lib/types";
import { humanize } from "../lib/format";
import { pickNumber, pickString } from "../lib/data";
import { StatusNote } from "./shared";

type Tone = "neutral" | "warm" | "cool";

function sentimentTone(value: string): Tone {
  const v = value.toLowerCase();
  if (/frustrat|angry|upset|annoy|negative|anxious|worried|irritat/.test(v)) return "warm";
  if (/happy|positive|satisf|calm|relieved|pleased/.test(v)) return "cool";
  return "neutral";
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-rule bg-sheet",
  warm: "border-brick/30 bg-brick-wash",
  cool: "border-leaf/30 bg-leaf-wash",
};

interface Reading {
  label: string;
  value: string;
  tone: Tone;
}

function readings(moment: Moment): Reading[] {
  const d = moment.data;
  const out: Reading[] = [];
  const intent = pickString(d, "intent");
  if (intent) out.push({ label: "Intent", value: humanize(intent), tone: "neutral" });
  const sentiment = pickString(d, "sentiment", "mood", "emotion");
  if (sentiment) out.push({ label: "Sentiment", value: humanize(sentiment), tone: sentimentTone(sentiment) });
  const language = pickString(d, "language", "lang");
  if (language) out.push({ label: "Language", value: humanize(language), tone: "neutral" });
  const urgency = pickString(d, "urgency", "priority");
  if (urgency) out.push({ label: "Urgency", value: humanize(urgency), tone: "neutral" });
  const orderId = pickString(d, "orderId", "order_id", "order");
  if (orderId) out.push({ label: "Order", value: orderId, tone: "neutral" });
  const confidence = pickNumber(d, "confidence");
  if (confidence !== undefined) {
    const pct = confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence);
    out.push({ label: "Confidence", value: `${pct}%`, tone: "neutral" });
  }
  return out;
}

/** What the agent heard. Set as speech, in the serif, with no box around it. */
export function UnderstoodMoment({ moment }: { moment: Moment }) {
  const quote = pickString(moment.data, "quote", "utterance", "said", "customerSaid", "transcript", "text");
  const statement = quote ?? moment.title;
  const gloss = quote ? moment.title : moment.detail;
  const items = readings(moment);

  return (
    <figure className="pb-1">
      <blockquote className="relative pl-8">
        <span
          aria-hidden
          className="absolute -top-3 left-0 select-none font-serif text-[3.25rem] leading-none text-sky"
        >
          &ldquo;
        </span>
        <p className="font-serif text-[1.375rem] italic leading-[1.4] text-navy [font-variation-settings:'opsz'_32]">
          {statement}
        </p>
      </blockquote>
      <figcaption className="mt-2.5 pl-8">
        {(gloss || moment.status !== "ok") && (
          <p className="flex flex-wrap items-baseline gap-x-3 text-[15px] text-muted">
            {gloss && <span>{gloss}</span>}
            <StatusNote status={moment.status} />
          </p>
        )}
        {quote && moment.detail && <p className="mt-0.5 text-[15px] text-muted">{moment.detail}</p>}
        {items.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-2">
            {items.map((r) => (
              <li
                key={r.label}
                className={`inline-flex items-baseline gap-1.5 rounded-full border px-3 py-1 text-sm ${TONE_CLASS[r.tone]}`}
              >
                <span className="text-muted">{r.label}</span>
                <span className="font-semibold text-ink">{r.value}</span>
              </li>
            ))}
          </ul>
        )}
      </figcaption>
    </figure>
  );
}
