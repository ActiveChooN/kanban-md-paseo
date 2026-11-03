import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { focusRing, font, noOutline, radius, space, tint, useInteraction, weight, type Theme } from "./design";

/** Bordered text input with a 2px accent ring while focused. Plain-object style so tests can read borderColor. */
export function inputStyle(theme: Theme, focused: boolean, size: "md" | "lg" = "md") {
  const large = size === "lg";
  return { color: theme.colors.foreground, backgroundColor: theme.colors.surface1, borderRadius: radius.control,
    fontSize: large ? 17 : font.md, fontWeight: large ? weight.semibold : weight.regular, minHeight: large ? 42 : 32,
    ...focusRing(theme, focused, theme.colors.border, { h: 10, v: large ? 8 : 6 }) } as const;
}

/** Status pill in the header. Opens the move menu; the status text stays legible when moving is disabled. */
export function StatusButton({ theme, status, open, disabled, accessibilityLabel, onPress }: {
  theme: Theme; status: string; open: boolean; disabled: boolean; accessibilityLabel: string; onPress(): void;
}) {
  const { focused, hovered, pressed, handlers } = useInteraction();
  const active = !disabled && (hovered || pressed || open);
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={`Status: ${status}`}
    accessibilityState={{ disabled, expanded: open }} disabled={disabled} onPress={onPress} {...handlers} hitSlop={4}
    style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0, minHeight: 26, borderRadius: radius.pill,
      backgroundColor: active ? theme.colors.surface2 : tint(theme.colors.foregroundMuted, 0.12, theme.colors.surface2),
      ...focusRing(theme, focused, open ? theme.colors.foregroundMuted : "transparent", { h: 10, v: 3 }) }}>
    <View style={{ width: 7, height: 7, borderRadius: radius.pill, borderWidth: 1.5, borderColor: theme.colors.foregroundMuted }} />
    <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: font.sm, fontWeight: weight.medium, flexShrink: 1 }}>{status}</Text>
    <View style={{ opacity: disabled ? 0.4 : 1 }}>
      <Icon name={open ? "ChevronUp" : "ChevronDown"} size={13} color={theme.colors.foregroundMuted} />
    </View>
  </Pressable>;
}

/** One row of the move menu. */
export function MenuRow({ theme, label, accessibilityLabel, disabled, onPress }: {
  theme: Theme; label: string; accessibilityLabel: string; disabled: boolean; onPress(): void;
}) {
  const { focused, hovered, pressed, handlers } = useInteraction();
  const active = !disabled && (hovered || pressed);
  return <Pressable accessibilityRole="menuitem" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} {...handlers}
    style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 30, borderRadius: radius.control,
      backgroundColor: active ? theme.colors.surface2 : "transparent", opacity: disabled ? 0.5 : 1,
      ...focusRing(theme, focused, "transparent", { h: 8, v: 4 }) }}>
    <View style={{ width: 14, alignItems: "center" }}>
      <View style={{ width: 7, height: 7, borderRadius: radius.pill, borderWidth: 1.5, borderColor: theme.colors.foregroundMuted }} />
    </View>
    <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: font.md, flex: 1 }}>{label}</Text>
    {(hovered || focused) && !disabled && <Icon name="ArrowRight" size={13} color={theme.colors.foregroundMuted} />}
  </Pressable>;
}

/** The current status row in the move menu, not pressable. */
export function CurrentMenuRow({ theme, label }: { theme: Theme; label: string }) {
  return <View accessible accessibilityLabel={`Current status: ${label}`}
    style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 30, paddingHorizontal: 8, paddingVertical: 4 }}>
    <View style={{ width: 14, alignItems: "center" }}><Icon name="Check" size={13} color={theme.colors.accent} /></View>
    <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: font.md, flex: 1 }}>{label}</Text>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: font.xs }}>Current</Text>
  </View>;
}

/** One half of a segmented control. The selected segment is inert. */
export function Segment({ theme, label, accessibilityLabel, selected, onPress }: {
  theme: Theme; label: string; accessibilityLabel: string; selected: boolean; onPress(): void;
}) {
  const { focused, hovered, pressed, handlers } = useInteraction();
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ selected }}
    onPress={() => { if (!selected) onPress(); }} {...handlers}
    style={{ minHeight: 22, borderRadius: radius.control - 2, justifyContent: "center",
      backgroundColor: selected ? theme.colors.surface0 : hovered || pressed ? theme.colors.surface2 : "transparent",
      ...focusRing(theme, focused, selected ? theme.colors.border : "transparent", { h: 10, v: 2 }) }}>
    <Text style={{ color: selected ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: font.sm, fontWeight: weight.medium }}>{label}</Text>
  </Pressable>;
}

export function SegmentedControl({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 2, padding: 2, borderRadius: radius.control, backgroundColor: theme.colors.surface1,
    borderWidth: 1, borderColor: theme.colors.border }}>{children}</View>;
}

/** An editable tag chip: inline input plus a remove button. */
export function TagChip({ theme, index, value, disabled, focused, autoFocus, onFocus, onBlur, onChangeText, onRemove }: {
  theme: Theme; index: number; value: string; disabled: boolean; focused: boolean; autoFocus: boolean;
  onFocus(): void; onBlur(): void; onChangeText(value: string): void; onRemove(): void;
}) {
  const remove = useInteraction();
  const width = Math.min(200, Math.max(24, Math.ceil(value.length * 7.2) + 4));
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 2, maxWidth: "100%", borderRadius: radius.pill,
    backgroundColor: focused ? theme.colors.surface1 : tint(theme.colors.foregroundMuted, 0.12, theme.colors.surface2),
    ...focusRing(theme, focused, "transparent", { h: 4, v: 0 }), paddingLeft: focused ? 8 : 9 }}>
    <TextInput accessibilityLabel={`Tag ${index + 1}`} value={value} editable={!disabled} autoFocus={autoFocus} placeholder="tag"
      placeholderTextColor={theme.colors.foregroundMuted} onFocus={onFocus} onBlur={onBlur} onChangeText={onChangeText}
      style={{ width, minWidth: 0, flexShrink: 1, color: theme.colors.foreground, fontSize: font.sm, fontWeight: weight.medium,
        paddingVertical: 3, paddingHorizontal: 0, borderWidth: 0, borderColor: "transparent", backgroundColor: "transparent", ...noOutline }} />
    <Pressable accessibilityRole="button" accessibilityLabel={`Remove tag ${index + 1}`} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onRemove} {...remove.handlers} hitSlop={6}
      style={{ borderRadius: radius.pill, backgroundColor: remove.hovered || remove.pressed ? theme.colors.surface2 : "transparent",
        ...focusRing(theme, remove.focused, "transparent", { h: 3, v: 3 }) }}>
      <Icon name="X" size={12} color={remove.hovered || remove.focused ? theme.colors.foreground : theme.colors.foregroundMuted} />
    </Pressable>
  </View>;
}

/** Label-left metadata row. */
export function DetailRow({ theme, label, align = "center", children }: {
  theme: Theme; label: string; align?: "center" | "start"; children: ReactNode;
}) {
  return <View style={{ flexDirection: "row", alignItems: align === "start" ? "flex-start" : "center", gap: space.md, minHeight: 28 }}>
    <Text style={{ width: 76, paddingTop: align === "start" ? 7 : 0, color: theme.colors.foregroundMuted, fontSize: font.sm }}>{label}</Text>
    <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>{children}</View>
  </View>;
}
