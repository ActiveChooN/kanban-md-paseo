import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";

export type Theme = PluginWorkspacePanelProps["theme"];
export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { control: 6, card: 8, panel: 10, pill: 999 } as const;
export const font = { xs: 11, sm: 12, md: 13, lg: 14, xl: 16, xxl: 20 } as const;
export const weight = { regular: "400", medium: "500", semibold: "600" } as const;

/** `color` at `alpha` when it is #rgb/#rrggbb; otherwise `fallback` (non-hex theme colors can't be blended safely). */
export function tint(color: string | undefined, alpha: number, fallback: string) {
  const hex = typeof color === "string" ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1] : undefined;
  if (!hex) return fallback;
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  return `#${full}${Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0")}`;
}

export function toneColor(theme: Theme, tone: Tone) {
  const { colors } = theme;
  return { neutral: colors.foregroundMuted, accent: colors.accent, success: colors.statusSuccess,
    warning: colors.statusWarning, danger: colors.statusDanger }[tone] ?? colors.foregroundMuted;
}

/** Soft background for a tone. Neutral uses surface2. */
export function toneSurface(theme: Theme, tone: Tone, alpha = 0.14) {
  return tone === "neutral" ? theme.colors.surface2 : tint(toneColor(theme, tone), alpha, theme.colors.surface2);
}

/** Tone and Lucide icon for a priority, by rank in the board's ordered `priorities` (lowest first). */
export function priorityStyle(priority: string, priorities: readonly string[]): { tone: Tone; icon: string; rank: number } {
  const index = priorities.indexOf(priority);
  if (index < 0) return { tone: "neutral", icon: "Minus", rank: 0 };
  const fromTop = priorities.length - 1 - index;
  const rank = priorities.length > 1 ? index / (priorities.length - 1) : 0;
  const tone: Tone = priorities.length >= 3 ? (fromTop === 0 ? "danger" : fromTop === 1 ? "warning" : "neutral")
    : priorities.length === 2 && fromTop === 0 ? "warning" : "neutral";
  // Solid strokes stay legible at badge size, unlike the signal bars' thin low/medium states.
  return { tone, icon: tone === "danger" ? "CircleAlert" : rank >= 0.6 ? "ChevronUp" : rank >= 0.3 ? "Minus" : "ChevronDown", rank };
}
