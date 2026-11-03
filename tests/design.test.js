import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable" }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: "Icon", ScrollView: "ScrollView" }));
import { ActivityDot, Badge, Banner, Button, dismissPickerMenu, focusRing, Meter, Picker, pickerTouchScope, priorityStyle, tint } from "../client/design";

const theme = { colors: { foreground: "#111", foregroundMuted: "#555", surface0: "#fff", surface1: "#eee", surface2: "#ddd", accent: "#36f",
  accentForeground: "#fff", border: "#aaa", statusSuccess: "#2a2", statusWarning: "#a50", statusDanger: "rgb(200, 0, 0)" } };
let tree;
const render = async (element) => act(async () => { tree = create(element); });
const pressables = () => tree.root.findAllByType("Pressable");
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });

it("tints hex colors and falls back for anything else", () => {
  expect(tint("#36f", 0.5, "fb")).toBe("#3366ff80");
  expect(tint("#123456", 1, "fb")).toBe("#123456ff");
  expect(tint("rgb(1, 2, 3)", 0.5, "fb")).toBe("fb");
  expect(tint(undefined, 0.5, "fb")).toBe("fb");
});

it("maps priorities by rank in the configured order", () => {
  const tones = (list) => list.map((priority) => priorityStyle(priority, list).tone);
  expect(tones(["low", "medium", "high", "critical"])).toEqual(["neutral", "neutral", "warning", "danger"]);
  expect(tones(["minor", "major"])).toEqual(["neutral", "warning"]);
  expect(tones(["only"])).toEqual(["neutral"]);
  expect(priorityStyle("unknown", ["low", "high"]).tone).toBe("neutral");
  const icons = (list) => list.map((priority) => priorityStyle(priority, list).icon);
  expect(icons(["low", "medium", "high", "critical"])).toEqual(["ChevronDown", "Minus", "ChevronUp", "CircleAlert"]);
});

it("separates the spoken label from an icon-only button's text", async () => {
  await render(createElement(Button, { label: "Open", accessibilityLabel: "Open agent for #12", icon: "ExternalLink", iconOnly: true, theme, onPress: vi.fn(), disabled: true }));
  expect(pressables()[0].props.accessibilityLabel).toBe("Open agent for #12");
  expect(pressables()[0].props.disabled).toBe(true);
  expect(tree.root.findAllByType("Text")).toHaveLength(0);
});

it("names removable chips by their remove action", async () => {
  const onRemove = vi.fn();
  await render(createElement(Badge, { label: "high", removeLabel: "Remove Priority: high", theme, onRemove }));
  expect(pressables().map((node) => node.props.accessibilityLabel)).toEqual(["Remove Priority: high"]);
  await render(createElement(Badge, { label: "ui", theme, onPress: vi.fn(), onRemove }));
  expect(pressables().map((node) => node.props.accessibilityLabel)).toEqual(["ui", "Remove ui"]);
  await render(createElement(Badge, { label: "critical", tone: "danger", icon: "CircleAlert", accessibilityLabel: "Priority critical", theme }));
  expect(pressables()).toHaveLength(0);
});

it("announces warning banners and labels status indicators", async () => {
  await render(createElement(Banner, { theme, tone: "warning", message: "Board data is stale." }));
  expect(tree.root.findAllByType("Text").find((node) => node.props.children === "Board data is stale.").props.accessibilityRole).toBe("alert");
  await render(createElement(Banner, { theme, tone: "info", message: "Saved." }));
  expect(tree.root.findAllByType("Text").find((node) => node.props.children === "Saved.").props.accessibilityRole).toBeUndefined();
  await render(createElement(ActivityDot, { theme, activity: "Needs input" }));
  expect(tree.root.findAllByType("View")[0].props.accessibilityLabel).toBe("Needs input");
  await render(createElement(Meter, { theme, value: 4, max: 3, label: "WIP 4 of 3" }));
  expect(tree.root.findAllByType("View")[0].props.accessibilityValue).toEqual({ min: 0, max: 3, now: 4 });
});

it("opts every focus ring out of the host's :focus-visible outline", () => {
  expect(focusRing(theme, true, theme.colors.border, { h: 8, v: 4 })).toMatchObject({ outlineWidth: 0, borderWidth: 2, borderColor: theme.colors.accent });
  expect(focusRing(theme, false, theme.colors.border, { h: 8, v: 4 })).toMatchObject({ outlineWidth: 0, borderWidth: 1 });
});

const options = [{ value: "", label: "All" }, { value: "todo", label: "todo", description: "Ready to start" }, { value: "done", label: "done" }];
const items = () => pressables().filter((node) => node.props.accessibilityRole === "menuitem");
const trigger = () => pressables()[0];

it("opens a picker menu, checks the current option and picks another", async () => {
  const onValueChange = vi.fn();
  await render(createElement(Picker, { theme, label: "Status", value: "", options, onValueChange }));
  expect(trigger().props.accessibilityLabel).toBe("Status: All");
  expect(trigger().props.accessibilityHint).toBe("Choose status");
  expect(trigger().props.accessibilityState).toEqual({ expanded: false, disabled: false });
  expect(items()).toHaveLength(0);
  await act(async () => trigger().props.onPress());
  expect(trigger().props.accessibilityState.expanded).toBe(true);
  expect(tree.root.findAllByType("View").some((node) => node.props.accessibilityRole === "menu")).toBe(true);
  expect(items().map((node) => [node.props.accessibilityLabel, node.props.accessibilityState.selected])).toEqual([["All", true], ["todo", false], ["done", false]]);
  expect(items()[1].props.accessibilityHint).toBe("Ready to start");
  await act(async () => items()[0].props.onPress());
  expect(onValueChange).not.toHaveBeenCalled();
  expect(items()).toHaveLength(0);
  await act(async () => trigger().props.onPress());
  await act(async () => items()[1].props.onPress());
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("todo");
  expect(items()).toHaveLength(0);
});

it("closes on Escape, outside presses and modal dismissal on web", async () => {
  const listeners = new Map();
  globalThis.document = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); } };
  try {
    await render(createElement(Picker, { theme, label: "Status", value: "", options, onValueChange: vi.fn() }));
    expect(listeners.size).toBe(0);
    expect(dismissPickerMenu()).toBe(false);
    await act(async () => trigger().props.onPress());
    const escape = { key: "Escape", preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    await act(async () => listeners.get("keydown")(escape));
    expect(escape.stopImmediatePropagation).toHaveBeenCalled();
    expect(items()).toHaveLength(0);
    expect(listeners.size).toBe(0);
    await act(async () => trigger().props.onPress());
    await act(async () => expect(dismissPickerMenu()).toBe(true));
    expect(items()).toHaveLength(0);
    expect(dismissPickerMenu()).toBe(false);
    await act(async () => trigger().props.onPress());
    await act(async () => listeners.get("pointerdown")({ target: {} }));
    expect(items()).toHaveLength(0);
  } finally { delete globalThis.document; }
});

it("closes on touches outside the picker on native, where there are no document events", async () => {
  const picker = (label) => createElement(Picker, { theme, label, value: "", options, onValueChange: vi.fn() });
  await render(createElement("View", pickerTouchScope, picker("Status"), picker("Tag")));
  const roots = () => tree.root.findAllByType("View").filter((node) => node.props.onTouchStart && node.props.onTouchStart !== pickerTouchScope.onTouchStart);
  const touch = (...nodes) => act(async () => { const event = {}; nodes.forEach((node) => node.props.onTouchStart(event)); });
  const scope = tree.root.findAllByType("View")[0];
  await act(async () => pressables()[0].props.onPress());
  await touch(roots()[0], scope);
  expect(items()).toHaveLength(3);
  await touch(scope);
  expect(items()).toHaveLength(0);
  await act(async () => pressables()[0].props.onPress());
  await touch(roots()[1], scope);
  expect(items()).toHaveLength(0);
});

it("shows focus rings for keyboard focus only on web", async () => {
  await render(createElement(Button, { label: "Go", theme, onPress: vi.fn() }));
  await act(async () => pressables()[0].props.onFocus({ target: { matches: () => false } }));
  expect(pressables()[0].props.style.borderWidth).toBe(1);
  await act(async () => pressables()[0].props.onFocus({ target: { matches: (selector) => selector === ":focus-visible" } }));
  expect(pressables()[0].props.style.borderWidth).toBe(2);
});

it("emphasizes active pickers, names the clear action and locks when disabled", async () => {
  const onClear = vi.fn();
  await render(createElement(Picker, { theme, label: "Status", value: "todo", options, onValueChange: vi.fn(), active: true, prefix: "Status",
    onClear, clearLabel: "Remove Status: todo" }));
  expect(pressables().map((node) => node.props.accessibilityLabel)).toEqual(["Status: todo", "Remove Status: todo"]);
  const pill = () => tree.root.findAllByType("View")[1];
  expect(pill().props.style.borderColor).not.toBe(theme.colors.border);
  await act(async () => trigger().props.onFocus());
  expect(pill().props.style).toMatchObject({ borderColor: theme.colors.accent, borderWidth: 2 });
  expect(trigger().props.style.outlineWidth).toBe(0);
  await act(async () => pressables()[1].props.onPress());
  expect(onClear).toHaveBeenCalled();
  await render(createElement(Picker, { theme, label: "Model", value: "m", options: [{ value: "m", label: "Model M" }], onValueChange: vi.fn(), disabled: true }));
  expect(trigger().props.accessibilityLabel).toBe("Model: Model M");
  expect(trigger().props.disabled).toBe(true);
  expect(trigger().props.accessibilityState).toEqual({ expanded: false, disabled: true });
  expect(tree.root.findAllByType("Icon").map((node) => node.props.name)).not.toContain("ChevronDown");
});
