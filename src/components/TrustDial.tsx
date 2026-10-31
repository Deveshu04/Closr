import { Gauge, Lock } from "lucide-react";
import { useId } from "react";

const LEVELS = [
  { id: "L0", name: "Shadow", hint: "L0 Shadow: Closr only suggests; a person takes every action" },
  { id: "L1", name: "Approve", hint: "L1 Approve: every action waits for a person's approval" },
  { id: "L2", name: "Auto", hint: "L2 Auto within limits" },
  { id: "L3", name: "Autonomous", hint: "Unlocks after proven accuracy" },
] as const;

const CURRENT = "L2";

/** The autonomy level Closr runs at, shown as a dial so nobody has to wonder how much it may do alone. Display only. */
export function TrustDial() {
  const tipId = useId();
  return (
    <div>
      <p className="flex items-center justify-between gap-2 text-[13px] text-white/60">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Gauge aria-hidden size={14} className="text-sky" />
          Trust dial
        </span>
        <span className="text-[11.5px] text-white/40">Set by Paytm care ops</span>
      </p>
      <ol aria-label="Autonomy level" className="mt-2 grid grid-cols-[1fr_1fr_1fr_1.3fr] gap-1 rounded-lg bg-white/[0.06] p-1 ring-1 ring-white/10">
        {LEVELS.map((level) => {
          if (level.id === CURRENT) {
            return (
              <li
                key={level.id}
                aria-current="step"
                className="rounded-md bg-sky px-0.5 py-1.5 text-center text-navy shadow-[0_6px_16px_-8px_rgb(0_186_242/0.9)]"
              >
                <span className="block text-[13px] font-bold leading-tight">{level.id}</span>
                <span className="block text-[10.5px] font-semibold leading-tight">{level.name}</span>
              </li>
            );
          }
          const tooltip = level.id === "L3";
          return (
            <li
              key={level.id}
              title={tooltip ? undefined : level.hint}
              tabIndex={tooltip ? 0 : undefined}
              aria-describedby={tooltip ? tipId : undefined}
              className="group relative rounded-md px-0.5 py-1.5 text-center text-white/45 focus:outline-none focus-visible:outline-2 focus-visible:outline-sky"
            >
              <span className="flex items-center justify-center gap-0.5 text-[13px] font-semibold leading-tight">
                <Lock aria-label="Locked" size={10} strokeWidth={2.5} />
                {level.id}
              </span>
              <span className="block truncate text-[10.5px] leading-tight tracking-[-0.01em]">{level.name}</span>
              {tooltip && (
                <span
                  id={tipId}
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-max max-w-[11rem] rounded-md bg-white px-2.5 py-1.5 text-left text-xs font-semibold leading-snug text-navy opacity-0 shadow-[0_10px_24px_-10px_rgb(0_0_0/0.5)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {level.hint}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[13px] leading-snug text-white/65">
        <span className="font-semibold text-white">L2 · Auto within limits.</span> Acts alone inside policy; above
        the limit, a specialist approves in one tap.
      </p>
    </div>
  );
}
