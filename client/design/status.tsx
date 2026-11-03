import { Text, View, type ViewStyle } from "react-native";
import type { Session } from "../agent-activity";
import { font, radius, tint, toneColor, type Theme, type Tone } from "./tokens";

export type Activity = Session["activity"];
export const activityTone: Record<Activity, Tone> = { Running: "success", "Needs input": "warning", Error: "danger", Idle: "neutral", Unavailable: "neutral" };

/** Agent activity dot. Unavailable renders hollow. Spoken as `label` (default: the activity). */
export function ActivityDot({ theme, activity, label, showLabel = false, size = 8 }: {
  theme: Theme; activity: Activity; label?: string; showLabel?: boolean; size?: number;
}) {
  const color = toneColor(theme, activityTone[activity]);
  const hollow = activity === "Unavailable";
  const halo = activity === "Running" || activity === "Needs input" || activity === "Error";
  const text = label ?? activity;
  return <View accessible accessibilityLabel={text} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <View style={{ width: size + 4, height: size + 4, borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
      backgroundColor: halo ? tint(color, 0.22, "transparent") : "transparent" }}>
      <View style={{ width: size, height: size, borderRadius: radius.pill, borderWidth: hollow ? 1.5 : 0, borderColor: color,
        backgroundColor: hollow ? "transparent" : color }} />
    </View>
    {showLabel && <Text style={{ color: theme.colors.foregroundMuted, fontSize: font.sm }}>{text}</Text>}
  </View>;
}

/** Fill meter, e.g. WIP count against a limit. Muted under the limit, warning at it, danger over it. */
export function Meter({ theme, value, max, label, width = 48, style }: {
  theme: Theme; value: number; max: number;
  /** Spoken name, e.g. "WIP 2 of 3". */
  label: string; width?: number; style?: ViewStyle;
}) {
  const tone: Tone = max > 0 && value > max ? "danger" : max > 0 && value === max ? "warning" : "neutral";
  const fill = max > 0 ? Math.min(1, value / max) : 0;
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max, now: value }}
    style={{ width, height: 4, borderRadius: radius.pill, backgroundColor: theme.colors.surface2, overflow: "hidden", ...style }}>
    <View style={{ width: `${fill * 100}%`, height: "100%", borderRadius: radius.pill, backgroundColor: toneColor(theme, tone) }} />
  </View>;
}

/** Placeholder block for content that is still loading. Static, so it reads the same on every platform. */
export function Skeleton({ theme, width = "100%", height, style }: {
  theme: Theme; width?: number | "100%"; height: number; style?: ViewStyle;
}) {
  return <View style={{ width, height, borderRadius: radius.control, backgroundColor: tint(theme.colors.foregroundMuted, 0.12, theme.colors.surface2), ...style }} />;
}
