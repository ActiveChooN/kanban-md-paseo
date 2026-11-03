import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { focusRing, noOutline, useInteraction } from "./interaction";
import { font, radius, space, tint, weight, type Theme } from "./tokens";

export type PickerOption<Value extends string = string> = { value: Value; label: string; description?: string; icon?: string };
export type PickerProps<Value extends string = string> = {
  theme: Theme;
  /** Field name. Spoken as "<label>: <selected option>". */
  label: string;
  value: Value; options: readonly PickerOption<Value>[]; onValueChange(value: Value): void;
  /** Lucide icon name shown before the text. */
  icon?: string;
  /** Muted text before the value, e.g. "Status". */
  prefix?: string;
  /** Visible trigger text; defaults to the selected option's label. */
  display?: string;
  /** Emphasize a non-default value. */
  active?: boolean;
  /** "ghost" = no border at rest (composer style), "outline" = 1px border. */
  variant?: "ghost" | "outline";
  disabled?: boolean;
  /** Adds an X that clears the value. Its spoken name is `clearLabel`. */
  onClear?(): void; clearLabel?: string;
  accessibilityHint?: string;
  menuWidth?: number;
  /** Layout only. Parents with later siblings need a zIndex above them for the menu to paint on top. */
  style?: ViewStyle;
};

// Web-only DOM surface; react-native-web refs are DOM nodes, native refs lack these methods.
type Node = { contains?(target: unknown): boolean; focus?(): void; getBoundingClientRect?(): { left: number } } | null;
type Listener = (event: { key?: string; target?: unknown; preventDefault(): void; stopImmediatePropagation(): void }) => void;
type Target = { addEventListener?(type: string, listener: Listener, capture: boolean): void; removeEventListener?(type: string, listener: Listener, capture: boolean): void };

const openMenus: (() => void)[] = [];
// Native has no document events. A touch that starts in a picker passes through its root first, so a scope around
// the panel closes the open menu on any other touch. Taps still reach their target, as on web.
let handledTouch: unknown = null;
const touchOutside = (event: unknown) => {
  if ((globalThis as { document?: unknown }).document || event === handledTouch) return;
  handledTouch = event;
  dismissPickerMenu();
};
export const pickerTouchScope = { onTouchStart: touchOutside };

/**
 * Closes the newest open picker menu; true if one was open. Host modals handle Escape before plugin code runs,
 * so a modal's `onOpenChange(false)` should call this and stay open when it returns true.
 */
export function dismissPickerMenu() {
  const close = openMenus[openMenus.length - 1];
  close?.();
  return !!close;
}

/**
 * Compact dropdown: a pill trigger that opens a menu below it. Escape and outside presses close it on web (see `dismissPickerMenu` in modals);
 * on native, touches inside a View spreading `pickerTouchScope` close it.
 */
export function Picker<Value extends string>({ theme, label, value, options, onValueChange, icon, prefix, display, active = false,
  variant = "outline", disabled = false, onClear, clearLabel, accessibilityHint, menuWidth = 240, style }: PickerProps<Value>) {
  const [open, setOpen] = useState(false);
  const [alignEnd, setAlignEnd] = useState(false);
  const { focused, hovered, pressed, handlers } = useInteraction();
  const clear = useInteraction();
  const root = useRef<View>(null);
  const trigger = useRef<View>(null);
  const { colors } = theme;
  const selected = options.find((option) => option.value === value);
  const shown = !disabled && open;
  useEffect(() => {
    if (!shown) return;
    const doc = (globalThis as { document?: Target }).document;
    const close = () => { setOpen(false); (trigger.current as Node)?.focus?.(); };
    const outside: Listener = (event) => { if (!(root.current as Node)?.contains?.(event.target)) setOpen(false); };
    const escape: Listener = (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); } };
    openMenus.push(close);
    doc?.addEventListener?.("pointerdown", outside, true);
    doc?.addEventListener?.("keydown", escape, true);
    return () => {
      openMenus.splice(openMenus.indexOf(close), 1);
      doc?.removeEventListener?.("pointerdown", outside, true); doc?.removeEventListener?.("keydown", escape, true);
    };
  }, [shown]);
  const toggle = () => {
    const left = (trigger.current as Node)?.getBoundingClientRect?.().left;
    const width = (globalThis as { innerWidth?: number }).innerWidth;
    setAlignEnd(left !== undefined && width !== undefined && left + menuWidth > width - space.md);
    setOpen(!open);
  };
  const choose = (next: Value) => { setOpen(false); (trigger.current as Node)?.focus?.(); if (next !== value) onValueChange(next); };
  const hot = !disabled && (hovered || pressed || shown);
  const border = active ? tint(colors.accent, 0.5, colors.foregroundMuted) : variant === "outline" || shown ? colors.border : "transparent";
  const background = active ? tint(colors.accent, hot ? 0.18 : 0.1, colors.surface2) : hot ? colors.surface2 : "transparent";
  const text = disabled ? colors.foregroundMuted : colors.foreground;
  return <View ref={root} onTouchStart={(event) => { if (shown) handledTouch = event; else touchOutside(event); }} style={{ flexShrink: 1, minWidth: 0, maxWidth: "100%", zIndex: shown ? 20 : 0, ...style }}>
    <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", maxWidth: "100%", borderRadius: radius.pill,
      backgroundColor: background, ...focusRing(theme, focused, border, { h: 1, v: 1 }) }}>
      <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? value}`}
        accessibilityHint={accessibilityHint ?? (disabled ? undefined : `Choose ${label.toLowerCase()}`)}
        accessibilityState={{ expanded: shown, disabled }} disabled={disabled} onPress={toggle} {...handlers} hitSlop={4}
        style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1, minWidth: 0, minHeight: 24, borderRadius: radius.pill,
          paddingLeft: 8, paddingRight: onClear && !disabled ? 2 : 8, ...noOutline }}>
        {icon && <Icon name={icon} size={13} color={active ? colors.accent : colors.foregroundMuted} />}
        {!!prefix && <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: font.sm }}>{prefix}</Text>}
        <Text numberOfLines={1} style={{ color: text, fontSize: font.sm, fontWeight: active ? weight.semibold : weight.medium, flexShrink: 1 }}>
          {display ?? selected?.label ?? value}
        </Text>
        {!disabled && !(onClear && active) && <Icon name="ChevronDown" size={13} color={colors.foregroundMuted} />}
      </Pressable>
      {onClear && !disabled && <Pressable accessibilityRole="button" accessibilityLabel={clearLabel ?? `Clear ${label}`} onPress={onClear} {...clear.handlers} hitSlop={6}
        style={{ borderRadius: radius.pill, marginRight: 4, ...focusRing(theme, clear.focused, "transparent", { h: 2, v: 2 }) }}>
        <Icon name="X" size={12} color={clear.hovered || clear.focused ? colors.foreground : colors.foregroundMuted} />
      </Pressable>}
    </View>
    {shown && <View accessibilityRole="menu" accessibilityLabel={label}
      style={{ position: "absolute", top: "100%", ...(alignEnd ? { right: 0 } : { left: 0 }), marginTop: space.xs, width: menuWidth,
        padding: space.xs, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.24)", elevation: 8 }}>
      <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: 1 }} keyboardShouldPersistTaps="handled">
        {options.map((option) => <PickerRow key={option.value} theme={theme} option={option} selected={option.value === value} onPress={() => choose(option.value)} />)}
      </ScrollView>
    </View>}
  </View>;
}

function PickerRow<Value extends string>({ theme, option, selected, onPress }: { theme: Theme; option: PickerOption<Value>; selected: boolean; onPress(): void }) {
  const { focused, hovered, pressed, handlers } = useInteraction();
  const { colors } = theme;
  return <Pressable accessibilityRole="menuitem" accessibilityLabel={option.label} accessibilityHint={option.description}
    accessibilityState={{ selected }} onPress={onPress} {...handlers}
    style={{ flexDirection: "row", alignItems: option.description ? "flex-start" : "center", gap: space.sm, minHeight: 30, borderRadius: radius.control,
      backgroundColor: hovered || pressed ? colors.surface2 : "transparent", ...focusRing(theme, focused, "transparent", { h: 8, v: 5 }) }}>
    <View style={{ width: 14, paddingTop: option.description ? 2 : 0, alignItems: "center" }}>
      {selected && <Icon name="Check" size={13} color={colors.accent} />}
    </View>
    {option.icon && <View style={{ paddingTop: option.description ? 2 : 0 }}><Icon name={option.icon} size={13} color={colors.foregroundMuted} /></View>}
    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: font.md, fontWeight: selected ? weight.medium : weight.regular }}>{option.label}</Text>
      {!!option.description && <Text style={{ color: colors.foregroundMuted, fontSize: font.sm, lineHeight: 16 }}>{option.description}</Text>}
    </View>
  </Pressable>;
}
