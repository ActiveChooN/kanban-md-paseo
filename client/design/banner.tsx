import { Icon } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { font, radius, space, tint, toneColor, weight, type Theme, type Tone } from "./tokens";

export type BannerTone = "info" | "success" | "warning" | "danger";
const tones: Record<BannerTone, { tone: Tone; icon: string }> = {
  info: { tone: "neutral", icon: "Info" }, success: { tone: "success", icon: "CircleCheck" },
  warning: { tone: "warning", icon: "TriangleAlert" }, danger: { tone: "danger", icon: "OctagonAlert" },
};

/** Inline status message. Warning/danger messages are announced (accessibilityRole="alert" on the message Text). */
export function Banner({ theme, tone = "info", title, message, icon, actions, style }: {
  theme: Theme; tone?: BannerTone; title?: string; message: string;
  /** Lucide icon name; defaults per tone. Pass "" to hide. */
  icon?: string;
  /** Buttons rendered under the message, e.g. <Button size="sm" … />. */
  actions?: ReactNode;
  style?: ViewStyle;
}) {
  const { tone: base, icon: fallback } = tones[tone];
  const color = toneColor(theme, base);
  const alert = tone === "warning" || tone === "danger";
  const name = icon ?? fallback;
  return <View style={{ flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.card, borderWidth: 1,
    borderColor: base === "neutral" ? theme.colors.border : tint(color, 0.4, theme.colors.border),
    backgroundColor: base === "neutral" ? theme.colors.surface1 : tint(color, 0.1, theme.colors.surface2), ...style }}>
    {!!name && <View style={{ paddingTop: 1 }}><Icon name={name} size={16} color={color} /></View>}
    <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
      {!!title && <Text aria-hidden style={{ color: theme.colors.foreground, fontSize: font.md, fontWeight: weight.semibold }}>{title}</Text>}
      <Text accessibilityRole={alert ? "alert" : undefined} accessibilityLiveRegion={alert ? undefined : "polite"}
        accessibilityLabel={title ? `${title}. ${message}` : undefined}
        style={{ color: theme.colors.foreground, fontSize: font.md, lineHeight: 18 }}>{message}</Text>
      {actions && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs }}>{actions}</View>}
    </View>
  </View>;
}
