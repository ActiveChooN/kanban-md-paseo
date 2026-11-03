import { Icon } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { focusRing, useInteraction } from "./interaction";
import { font, radius, tint, weight, type Theme } from "./tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonProps = {
  label: string; onPress(): void; theme: Theme;
  variant?: ButtonVariant; size?: "sm" | "md";
  /** Lucide icon name, e.g. "Plus". */
  icon?: string;
  /** Show only the icon; `label` still names it for assistive tech. */
  iconOnly?: boolean;
  /** Extra content after the label, e.g. a count Badge. */
  trailing?: ReactNode;
  selected?: boolean; disabled?: boolean;
  /** Defaults to `label`. Use when the visible label is shorter than the spoken one. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Layout only (flex, alignSelf, margins). Plain object so tests can read it. */
  style?: ViewStyle;
};

const sizes = { sm: { height: 28, h: 8, v: 4, text: font.sm, icon: 14 }, md: { height: 34, h: 12, v: 6, text: font.md, icon: 16 } };

export function buttonColors(theme: Theme, variant: ButtonVariant, state: { selected: boolean; active: boolean }) {
  const { colors } = theme;
  const { selected, active } = state;
  switch (variant) {
    case "primary": return { background: colors.accent, border: colors.accent, text: colors.accentForeground ?? colors.surface0, ring: colors.foreground, opacity: active ? 0.88 : 1 };
    case "danger": return { background: tint(colors.statusDanger, active ? 0.2 : 0.1, colors.surface1), border: tint(colors.statusDanger, 0.45, colors.border),
      text: colors.statusDanger ?? colors.foreground, ring: colors.accent, opacity: 1 };
    case "ghost": return { background: selected || active ? colors.surface2 : "transparent", border: "transparent",
      text: selected || active ? colors.foreground : colors.foregroundMuted, ring: colors.accent, opacity: 1 };
    default: return { background: selected || active ? colors.surface2 : colors.surface1, border: selected ? colors.foregroundMuted : colors.border,
      text: colors.foreground, ring: colors.accent, opacity: 1 };
  }
}

export function Button({ label, onPress, theme, variant = "secondary", size = "md", icon, iconOnly = false, trailing,
  selected = false, disabled = false, accessibilityLabel, accessibilityHint, style }: ButtonProps) {
  const { focused, hovered, pressed, handlers } = useInteraction();
  const metrics = sizes[size];
  const colors = buttonColors(theme, variant, { selected, active: !disabled && (hovered || pressed) });
  const square = iconOnly && !!icon;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityHint={accessibilityHint}
    accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} {...handlers}
    hitSlop={size === "sm" ? 6 : undefined}
    style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, maxWidth: "100%",
      minHeight: metrics.height, ...(square ? { width: metrics.height } : {}), borderRadius: radius.control,
      backgroundColor: colors.background, opacity: disabled ? 0.5 : colors.opacity,
      ...focusRing(theme, focused, colors.border, { h: square ? 0 : metrics.h, v: metrics.v }, colors.ring), ...style }}>
    {icon && <Icon name={icon} size={metrics.icon} color={colors.text} />}
    {!square && <Text style={{ color: colors.text, fontSize: metrics.text, fontWeight: weight.medium, flexShrink: 1 }}>{label}</Text>}
    {trailing && <View style={{ flexShrink: 0 }}>{trailing}</View>}
  </Pressable>;
}
