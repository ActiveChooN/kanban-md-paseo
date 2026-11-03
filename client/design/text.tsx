import type { ReactNode } from "react";
import { Text, View, type TextStyle, type ViewStyle } from "react-native";
import { font, radius, space, weight, type Theme } from "./tokens";

/** Small uppercase muted label, e.g. metadata keys or group captions. */
export function Label({ theme, children, style }: { theme: Theme; children: string; style?: TextStyle }) {
  return <Text style={{ color: theme.colors.foregroundMuted, fontSize: font.xs, fontWeight: weight.semibold, letterSpacing: 0.6,
    textTransform: "uppercase", ...style }}>{children}</Text>;
}

/** Header row: title (accessibilityRole="header"), optional count pill, trailing slot (meter, actions). */
export function SectionHeader({ theme, title, count, countLabel, trailing, style }: {
  theme: Theme; title: string; count?: number;
  /** Spoken count, e.g. "3 tickets". */
  countLabel?: string;
  trailing?: ReactNode; style?: ViewStyle;
}) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 24, ...style }}>
    <Text accessibilityRole="header" numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: font.md, fontWeight: weight.semibold, flexShrink: 1 }}>{title}</Text>
    {count !== undefined && <View accessible accessibilityLabel={countLabel ?? String(count)} style={{ minWidth: 20, paddingHorizontal: 6, paddingVertical: 1,
      borderRadius: radius.pill, backgroundColor: theme.colors.surface2, alignItems: "center" }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: font.xs, fontWeight: weight.medium }}>{count}</Text>
    </View>}
    {trailing && <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: space.sm }}>{trailing}</View>}
  </View>;
}
