import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Anchor,
  Backpack,
  Compass,
  Cpu,
  Crown,
  Gauge,
  Gem,
  Leaf,
  Link as LinkIcon,
  Moon,
  Mountain,
  Sparkles,
  Square,
  Watch as WatchIcon,
  Waves
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  Waves,
  Gem,
  Compass,
  Cpu,
  Anchor,
  Gauge,
  Mountain,
  Crown,
  Moon,
  Sparkles,
  Leaf,
  Square,
  Backpack,
  Watch: WatchIcon,
  Activity,
  Link: LinkIcon
};

export function NodeIcon({ name, size = 28 }: { name?: string; size?: number }) {
  const Component = (name ? MAP[name] : undefined) ?? WatchIcon;
  return <Component size={size} strokeWidth={1.8} aria-hidden="true" />;
}
