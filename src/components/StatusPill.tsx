import { humanize } from "./lib/format";

const TONES: { match: RegExp; className: string }[] = [
  { match: /fail|reject|cancel|deni|lost|rto|undeliver/, className: "bg-brick-wash text-brick" },
  { match: /pending|await|open|request|escalat|hold|delay|stuck/, className: "bg-amber-wash text-amber" },
  { match: /out_for|transit|ship|picked|dispatch|progress|manifest/, className: "bg-sky-wash text-navy" },
  { match: /deliver|process|resolv|pass|refund|complet|approv|success|paid|issued/, className: "bg-leaf-wash text-leaf" },
];

export function StatusPill({ value }: { value: string | undefined }) {
  if (!value) return <span className="text-faint">—</span>;
  const key = value.toLowerCase().replace(/[\s-]+/g, "_");
  const tone = TONES.find((t) => t.match.test(key))?.className ?? "bg-paper text-ink";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-semibold ${tone}`}>
      {humanize(value)}
    </span>
  );
}
