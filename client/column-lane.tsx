import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { font, focusRing, Meter, radius, SectionHeader, space, tint, useInteraction, type Theme } from "./design";

/** Lane surface: a faint wash of the foreground over the panel background. */
export function laneBackground(theme: Theme) {
  return tint(theme.colors.foregroundMuted, 0.07, theme.colors.surface1);
}

function LaneHeader({ theme, name, count, wip, wipLimit }: { theme: Theme; name: string; count: number; wip: number; wipLimit: number | null }) {
  return <SectionHeader theme={theme} title={name} count={count} countLabel={`${count} ticket${count === 1 ? "" : "s"}`}
    trailing={wipLimit !== null ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text aria-hidden style={{ color: wip > wipLimit ? theme.colors.statusDanger : wip === wipLimit ? theme.colors.statusWarning : theme.colors.foregroundMuted,
        fontSize: font.xs, fontVariant: ["tabular-nums"] }}>WIP {wip}/{wipLimit}</Text>
      <Meter theme={theme} value={wip} max={wipLimit} label={`WIP ${wip} of ${wipLimit}`} width={36} />
    </View> : undefined} />;
}

/**
 * Status column. On wide layouts the header doubles as the status navigation control
 * (named "<status> · <count>", like the compact tabs); compact layouts keep separate tabs,
 * so their lane only shows a header when it has a WIP meter to display.
 */
export function ColumnLane({ theme, name, count, wip, wipLimit, compact, selected, onNavigate, onLayout, children }: {
  theme: Theme; name: string; count: number; wip: number; wipLimit: number | null; compact: boolean;
  selected: boolean; onNavigate?(): void;
  /** Reports the lane's x offset in the board, for scrolling to it. */
  onLayout?(x: number): void;
  children: ReactNode;
}) {
  const { focused, hovered, handlers } = useInteraction();
  const header = <LaneHeader theme={theme} name={name} count={count} wip={wip} wipLimit={wipLimit} />;
  // Wide lanes share the board width between 260 and 340; the board scrolls when they no longer fit.
  return <View onLayout={onLayout && ((event) => onLayout(event.nativeEvent.layout.x))}
    style={{ ...(compact ? { width: "100%" } : { width: 260, flexGrow: 1, flexShrink: 0, maxWidth: 340, alignSelf: "stretch" }),
      gap: space.sm, padding: space.sm, borderRadius: radius.panel, backgroundColor: laneBackground(theme) }}>
    {onNavigate ? <Pressable accessibilityRole="button" accessibilityLabel={`${name} · ${count}`} accessibilityState={{ selected }}
      onPress={onNavigate} {...handlers}
      style={{ borderRadius: radius.control, backgroundColor: hovered ? tint(theme.colors.foregroundMuted, 0.08, theme.colors.surface2) : "transparent",
        ...focusRing(theme, focused, "transparent", { h: 6, v: space.xs }) }}>
      {header}
    </Pressable> : (!compact || wipLimit !== null) && <View style={{ paddingHorizontal: 6, paddingVertical: space.xs }}>{header}</View>}
    {children}
  </View>;
}

/** Dashed placeholder for a lane with no tickets. */
export function EmptyLane({ theme }: { theme: Theme }) {
  return <View style={{ minHeight: 64, alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed",
    borderColor: tint(theme.colors.foregroundMuted, 0.35, theme.colors.border), borderRadius: radius.card, padding: space.md }}>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: font.sm }}>No tickets in this status.</Text>
  </View>;
}
