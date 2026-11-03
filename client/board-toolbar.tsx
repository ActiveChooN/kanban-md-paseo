import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { forwardRef, useState } from "react";
import { Text, View, type TextInput as NativeTextInput } from "react-native";
import { Badge, Button, focusRing, font, noOutline, Picker, radius, space, weight, type PickerOption, type Theme } from "./design";

export type FilterChip = { label: string; clear(): void };

/** Board title, ticket count and board-level actions. */
export function BoardHeader({ theme, name, shown, total, onRefresh, refreshDisabled, onNew, newDisabled }: {
  theme: Theme; name: string; shown: number; total: number;
  onRefresh(): void; refreshDisabled: boolean; onNew(): void; newDisabled: boolean;
}) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
    <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: space.sm, rowGap: 2 }}>
      <Text accessibilityRole="header" numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: font.xxl, fontWeight: weight.semibold, flexShrink: 1 }}>{name}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: font.md, fontVariant: ["tabular-nums"] }}>{shown} / {total} tickets</Text>
    </View>
    <Button theme={theme} variant="ghost" icon="RefreshCw" iconOnly label="Refresh board" disabled={refreshDisabled} onPress={onRefresh} />
    <Button theme={theme} variant="primary" icon="Plus" label="New ticket" disabled={newDisabled} onPress={onNew} />
  </View>;
}

/** Search box with a leading icon; the whole field carries the focus ring. */
export const SearchField = forwardRef<NativeTextInput, { theme: Theme; value: string; onChange(value: string): void }>(
  function SearchField({ theme, value, onChange }, ref) {
    const [focused, setFocused] = useState(false);
    return <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 34,
      borderRadius: radius.control, backgroundColor: theme.colors.surface1,
      ...focusRing(theme, focused, theme.colors.border, { h: 10, v: 0 }) }}>
      <Icon name="Search" size={15} color={focused ? theme.colors.foreground : theme.colors.foregroundMuted} />
      <TextInput ref={ref} accessibilityLabel="Search tickets by ID or title" placeholder="Search ID or title" value={value}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChangeText={onChange} placeholderTextColor={theme.colors.foregroundMuted}
        style={{ flex: 1, minWidth: 0, paddingVertical: 7, fontSize: font.md, color: theme.colors.foreground, ...noOutline }} />
    </View>;
  });

/** Removable chips for active filters plus a ghost clear-all. */
export function FilterChips({ theme, chips, onClear }: { theme: Theme; chips: FilterChip[]; onClear(): void }) {
  return <View accessibilityLabel="Active filters" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
    {chips.map((chip) => <Badge key={chip.label} theme={theme} label={chip.label} onRemove={chip.clear} appearance="outline" />)}
    <Button theme={theme} variant="ghost" size="sm" label="Clear filters" onPress={onClear} />
  </View>;
}

export type FilterField = {
  label: string; icon: string; value: string; options: PickerOption[];
  /** Chip text when the filter is active, e.g. "Status: todo"; null at its default. */
  chip: string | null;
  onChange(value: string): void; clear(): void;
};

/** One picker per filter. Active filters show their value and an X named like their chip. */
export function FilterBar({ theme, fields, onClear }: { theme: Theme; fields: FilterField[]; onClear?(): void }) {
  return <View accessibilityLabel="Filters" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, zIndex: 10 }}>
    {fields.map((field) => <Picker key={field.label} theme={theme} label={field.label} icon={field.icon} value={field.value} options={field.options}
      onValueChange={field.onChange} active={!!field.chip} prefix={field.chip ? field.label : undefined} display={field.chip ? undefined : field.label}
      onClear={field.chip ? field.clear : undefined} clearLabel={field.chip ? `Remove ${field.chip}` : undefined} />)}
    {onClear && <Button theme={theme} variant="ghost" size="sm" label="Clear filters" onPress={onClear} />}
  </View>;
}

/** Compact-only status switcher. Each tab is named "<status> · <count>". */
export function StatusTabs({ theme, tabs, selected, onSelect }: {
  theme: Theme; tabs: { name: string; count: number }[]; selected: string | undefined; onSelect(name: string, index: number): void;
}) {
  return <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.xs }} accessibilityLabel="Status navigation" showsHorizontalScrollIndicator={false}>
    {tabs.map((tab, index) => <Button key={tab.name} theme={theme} variant="ghost" size="sm" selected={selected === tab.name}
      label={tab.name} accessibilityLabel={`${tab.name} · ${tab.count}`} onPress={() => onSelect(tab.name, index)}
      trailing={<Text style={{ color: theme.colors.foregroundMuted, fontSize: font.xs, fontVariant: ["tabular-nums"] }}>{tab.count}</Text>} />)}
  </ScrollView>;
}

/** Centered note for an empty board or a filter set with no matches. */
export function EmptyResults({ theme, empty, onClear }: { theme: Theme; empty: boolean; onClear?(): void }) {
  return <View style={{ alignItems: "center", gap: space.sm, paddingVertical: space.lg, paddingHorizontal: space.md }}>
    <View style={{ width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface2 }}>
      <Icon name={empty ? "Inbox" : "SearchX"} size={18} color={theme.colors.foregroundMuted} />
    </View>
    <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.foreground, fontSize: font.md, fontWeight: weight.medium, textAlign: "center" }}>
      {empty ? "This board has no tickets yet." : "No tickets match these filters."}
    </Text>
    {onClear && <Button theme={theme} size="sm" icon="X" label="Clear all filters" onPress={onClear} />}
  </View>;
}
