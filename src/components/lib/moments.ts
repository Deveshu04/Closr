import type { Moment } from "@/lib/types";

/** Oldest first by timestamp; moments with equal or unreadable times keep their arrival order. */
export function chronological(moments: Moment[]): Moment[] {
  return moments
    .map((m, i) => ({ m, i, t: Date.parse(m.at) }))
    .sort((a, b) => (Number.isFinite(a.t) && Number.isFinite(b.t) && a.t !== b.t ? a.t - b.t : a.i - b.i))
    .map(({ m }) => m);
}
