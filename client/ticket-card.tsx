import { Icon } from "@getpaseo/plugin/client/ui";
import type { Ref } from "react";
import { Pressable, Text, View } from "react-native";
import type { TicketSummary } from "../shared/ticket";
import { ActivityDot, Badge, Button, font, noOutline, priorityStyle, radius, space, tint, toneColor, useInteraction, weight, type Activity, type Theme, type Tone } from "./design";

/** Card activity footer: nothing when there are no sessions. */
export type CardActivity = { kind: "none" } | { kind: "unavailable" } | { kind: "sessions"; primary: Activity; count: number };

const MAX_TAGS = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Short label and tone for a YYYY-MM-DD due date: danger when overdue, warning when due today. */
export function dueStyle(due: string, now = new Date()): { label: string; tone: Tone; spoken: string } {
  const today = localIsoDate(now);
  const [year, month, day] = due.split("-").map(Number);
  const short = `${MONTHS[(month ?? 0) - 1] ?? due} ${day}${year !== now.getFullYear() ? `, ${year}` : ""}`;
  if (due < today) return { label: short, tone: "danger", spoken: `Overdue, due ${short}` };
  if (due === today) return { label: "Today", tone: "warning", spoken: "Due today" };
  return { label: short, tone: "neutral", spoken: `Due ${short}` };
}

export function TicketCard({ ticket, theme, priorities, selected, disabled, onSelect, activity, onImplement, launchDisabled, recovering, onOpenAgent, ref }: {
  ticket: TicketSummary; theme: Theme; priorities: readonly string[];
  /** The ticket open in the editor. */
  selected: boolean; disabled: boolean; onSelect(): void;
  activity: CardActivity; onImplement?(): void; launchDisabled: boolean; recovering: boolean; onOpenAgent?(): void;
  /** The card's pressable, so focus can return to it. */
  ref?: Ref<View>;
}) {
  const { colors } = theme;
  const { focused, hovered, handlers } = useInteraction();
  const priority = priorityStyle(ticket.priority, priorities);
  const due = ticket.due ? dueStyle(ticket.due) : null;
  const tags = ticket.tags.slice(0, MAX_TAGS);
  const hiddenTags = ticket.tags.length - tags.length;
  const actions = (onImplement ? 1 : 0) + (onOpenAgent ? 1 : 0);
  const border = focused || selected ? colors.accent : hovered && !disabled ? tint(colors.foregroundMuted, 0.55, colors.foregroundMuted) : colors.border;
  const ring = focused ? 2 : 1;
  const pad = space.md - (ring - 1);
  const hasMeta = !!due || !!ticket.assignee || tags.length > 0;
  return <View style={{ borderWidth: ring, borderRadius: radius.card, borderColor: border,
    backgroundColor: selected ? tint(colors.accent, 0.07, colors.surface1) : colors.surface1 }}>
    <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={`Select ticket #${ticket.id}: ${ticket.title}, ${ticket.priority}${ticket.blocked ? ", blocked" : ""}`}
      accessibilityHint={selected ? "Open in the editor" : "Opens in the editor"}
      accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onSelect} {...handlers}
      style={{ padding: pad, gap: space.sm, borderRadius: radius.card, ...noOutline }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 20, paddingRight: actions * 30 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: font.sm, fontWeight: weight.medium }}>#{ticket.id}</Text>
        <Badge theme={theme} label={ticket.priority} tone={priority.tone} icon={priority.icon} />
      </View>
      <Text numberOfLines={3} style={{ color: colors.foreground, fontSize: font.lg, fontWeight: weight.semibold, lineHeight: 19 }}>{ticket.title}</Text>
      {ticket.blocked && <View accessible accessibilityLabel={ticket.blockReason ? `Blocked: ${ticket.blockReason}` : "Blocked"}
        style={{ flexDirection: "row", gap: 6, paddingHorizontal: space.sm, paddingVertical: 5, borderRadius: radius.control,
          backgroundColor: tint(colors.statusWarning, 0.12, colors.surface2) }}>
        <View style={{ paddingTop: 1 }}><Icon name="Ban" size={12} color={toneColor(theme, "warning")} /></View>
        <Text numberOfLines={2} style={{ flex: 1, color: colors.statusWarning, fontSize: font.sm, lineHeight: 16 }}>
          <Text style={{ fontWeight: weight.semibold }}>Blocked</Text>{ticket.blockReason ? ` · ${ticket.blockReason}` : ""}
        </Text>
      </View>}
      {hasMeta && <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs }}>
        {due && <Badge theme={theme} label={due.label} tone={due.tone} icon="Calendar" accessibilityLabel={due.spoken} />}
        {ticket.assignee && <Badge theme={theme} label={ticket.assignee} icon="User" appearance="outline" accessibilityLabel={`Assignee ${ticket.assignee}`} />}
        {tags.map((tag) => <Badge key={tag} theme={theme} label={tag} accessibilityLabel={`Tag ${tag}`} />)}
        {hiddenTags > 0 && <Badge theme={theme} label={`+${hiddenTags}`} appearance="outline" accessibilityLabel={`${hiddenTags} more tags`} />}
      </View>}
      {activity.kind !== "none" && <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", marginTop: 2, paddingTop: space.sm,
        borderTopWidth: 1, borderColor: tint(colors.border, 0.6, colors.border) }}>
        <ActivityDot theme={theme} activity={activity.kind === "sessions" ? activity.primary : "Unavailable"} size={7} showLabel
          label={activity.kind === "sessions" ? `${activity.primary} · ${activity.count} session${activity.count === 1 ? "" : "s"}` : "Agent activity unavailable"} />
      </View>}
    </Pressable>
    {actions > 0 && <View style={{ position: "absolute", top: space.sm - (ring - 1), right: space.sm - (ring - 1), flexDirection: "row", gap: 2 }}>
      {onOpenAgent && <Button theme={theme} variant="ghost" size="sm" icon="MessageSquare" iconOnly label={`Open agent for #${ticket.id}`} onPress={onOpenAgent} />}
      {onImplement && <Button theme={theme} variant="ghost" size="sm" icon={recovering ? "RotateCcw" : "Play"} iconOnly disabled={launchDisabled}
        label={recovering ? `Inspect launch #${ticket.id}` : `Implement #${ticket.id}`} onPress={onImplement} />}
    </View>}
  </View>;
}
