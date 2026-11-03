import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { focusRing, useInteraction } from "./interaction";
import { font, radius, tint, toneColor, toneSurface, weight, type Theme, type Tone } from "./tokens";

export type BadgeProps = {
  label: string; theme: Theme; tone?: Tone;
  /** Lucide icon name shown before the label. */
  icon?: string;
  /** "soft" = tinted fill (default), "outline" = border only. */
  appearance?: "soft" | "outline";
  /** sm for card metadata/counts, md for chips. Interactive badges default to md. */
  size?: "sm" | "md";
  /** Static: spoken instead of the label. Interactive: the button's name. */
  accessibilityLabel?: string;
  onPress?(): void;
  /** Shows an X. Without `onPress` the whole chip removes; with it, the X is its own button. */
  onRemove?(): void;
  /** Spoken name of the remove action. Defaults to `Remove ${label}`. */
  removeLabel?: string;
  selected?: boolean; disabled?: boolean;
  style?: ViewStyle;
};

export function Badge({ label, theme, tone = "neutral", icon, appearance = "soft", size, accessibilityLabel, onPress, onRemove, removeLabel,
  selected = false, disabled = false, style }: BadgeProps) {
  const { focused, hovered, pressed, handlers } = useInteraction();
  const remove = useInteraction();
  const interactive = !!(onPress || onRemove);
  const metrics = (size ?? (interactive ? "md" : "sm")) === "md" ? { h: 8, v: 3, text: font.sm, icon: 13 } : { h: 6, v: 1, text: font.xs, icon: 12 };
  const color = tone === "neutral" ? theme.colors.foregroundMuted : toneColor(theme, tone);
  const text = tone === "neutral" && (interactive || selected) ? theme.colors.foreground : color;
  const active = !disabled && (hovered || pressed);
  const background = appearance === "outline" && !selected && !active ? "transparent"
    : tone === "neutral" ? (active || selected ? theme.colors.surface2 : tint(theme.colors.foregroundMuted, 0.12, theme.colors.surface2))
    : toneSurface(theme, tone, active || selected ? 0.22 : 0.14);
  const border = appearance === "outline" || selected ? tint(color, 0.5, theme.colors.border) : "transparent";
  const removeName = removeLabel ?? `Remove ${label}`;
  const content = <>
    {icon && <Icon name={icon} size={metrics.icon} color={color} />}
    <Text numberOfLines={1} style={{ color: text, fontSize: metrics.text, fontWeight: weight.medium, flexShrink: 1 }}>{label}</Text>
  </>;
  const shape = { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", maxWidth: "100%",
    borderRadius: radius.pill, backgroundColor: background, opacity: disabled ? 0.5 : 1 } as const;
  const x = (focusedX: boolean) => <Icon name="X" size={metrics.icon} color={focusedX ? theme.colors.foreground : theme.colors.foregroundMuted} />;
  if (!interactive) return <View accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}
    style={{ ...shape, ...focusRing(theme, false, border, { h: metrics.h, v: metrics.v }), ...style }}>{content}</View>;
  if (!onPress && onRemove) return <Pressable accessibilityRole="button" accessibilityLabel={removeName} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onRemove} {...handlers} style={{ ...shape, ...focusRing(theme, focused, border, { h: metrics.h, v: metrics.v }), ...style }}>
    {content}{x(hovered || focused)}
  </Pressable>;
  return <View style={{ ...shape, gap: 0, ...style }}>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected, disabled }}
      disabled={disabled} onPress={onPress} {...handlers}
      style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, borderRadius: radius.pill, ...focusRing(theme, focused, border, { h: metrics.h, v: metrics.v }) }}>
      {content}
    </Pressable>
    {onRemove && <Pressable accessibilityRole="button" accessibilityLabel={removeName} accessibilityState={{ disabled }} disabled={disabled} onPress={onRemove}
      {...remove.handlers} hitSlop={6}
      style={{ borderRadius: radius.pill, marginLeft: -4, marginRight: 2, ...focusRing(theme, remove.focused, "transparent", { h: 3, v: 3 }) }}>
      {x(remove.hovered || remove.focused)}
    </Pressable>}
  </View>;
}
