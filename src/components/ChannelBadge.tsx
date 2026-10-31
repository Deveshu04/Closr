import { type LucideIcon, MessageSquareText, PhoneCall } from "lucide-react";
import type { Channel } from "./lib/records";

const META: Record<Channel, { label: string; icon: LucideIcon }> = {
  voice: { label: "Voice call", icon: PhoneCall },
  chat: { label: "Chat", icon: MessageSquareText },
};

/** Which way the customer is reaching Closr; chat is set apart because it changes how a specialist follows up. */
export function ChannelBadge({ channel, tone = "light" }: { channel: Channel; tone?: "light" | "dark" }) {
  const { label, icon: Icon } = META[channel];
  const look =
    tone === "dark"
      ? channel === "chat"
        ? "bg-sky text-navy"
        : "bg-white/10 text-white/85 ring-1 ring-inset ring-white/20"
      : channel === "chat"
        ? "bg-sky-wash text-navy ring-1 ring-inset ring-sky/40"
        : "bg-paper text-muted ring-1 ring-inset ring-rule";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full py-0.5 pl-1.5 pr-2 text-[12px] font-semibold leading-5 ${look}`}
    >
      <Icon aria-hidden size={12} strokeWidth={2.5} />
      {label}
    </span>
  );
}
