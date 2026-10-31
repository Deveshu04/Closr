import type { Moment } from "@/lib/types";
import { isTrouble } from "./shared";

export function CallLine({ moment }: { moment: Moment }) {
  const trouble = isTrouble(moment.status);
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 pt-1 text-[15px] leading-snug">
      <span className={`font-semibold ${trouble ? "text-brick" : "text-navy"}`}>{moment.title}</span>
      {moment.detail && <span className="min-w-0 break-words text-muted">{moment.detail}</span>}
    </p>
  );
}
