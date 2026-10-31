import { humanize } from "./lib/format";

const TONES: { match: RegExp; className: string }[] = [
  { match: /fail|reject|cancel|deni|expired|offline|not_credit|frozen|closed/, className: "bg-brick-wash text-brick" },
  { match: /progress|processing|review|dialing|ringing/, className: "bg-sky-wash text-navy" },
  { match: /pending|await|open|raised|escalat|hold|stuck/, className: "bg-amber-wash text-amber" },
  {
    match: /success|settled|credited|process|refund|revers|resolv|online|complet|approv|active|pass|paid/,
    className: "bg-leaf-wash text-leaf",
  },
];

const LABELS: Record<string, string> = {
  debited_not_credited: "Debited, not credited",
  pending_approval: "Awaiting approval",
  in_progress: "In progress",
  in_review: "In review",
  on_hold: "On hold",
};

export function StatusPill({ value }: { value: string | undefined }) {
  if (!value) return <span className="text-faint">—</span>;
  const key = value.toLowerCase().replace(/[\s-]+/g, "_");
  const tone = TONES.find((t) => t.match.test(key))?.className ?? "bg-paper text-muted ring-1 ring-inset ring-rule";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-0.5 pl-2 pr-2.5 text-[12.5px] font-semibold leading-5 ${tone}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" />
      {LABELS[key] ?? humanize(value)}
    </span>
  );
}
