import { activitySdk } from "./activity-fixtures";
import { createElement, useState } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { config, ticket } from "./ticket-fixtures";

const activity = vi.hoisted(() => ({ state: "active", listeners: new Set() }));
// Paseo owns these native host components. Exercise our React state and event handlers.
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable",
  AppState: { get currentState() { return activity.state; }, addEventListener: (_name, listener) => { activity.listeners.add(listener); return { remove: () => activity.listeners.delete(listener) }; } } }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: "Icon", Loading: "Loading", Markdown: "Markdown", ScrollView: "ScrollView", SettingsSelect: "SettingsSelect", SettingsSwitch: "SettingsSwitch", TextInput: "TextInput" }));
const rpc = vi.hoisted(() => new Map());
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => sdk, useRpc: (contract) => rpc.get(contract.name), useHosts: () => [{ serverId: props.host.id, status: "online" }, { serverId: "h2", status: "online" }],
  useWorkspace: () => null,
  useTabState: (_tab, _schema, initial) => useState(initial) }));
import { BoardQuery } from "../client/board-query";
import { TicketEditor } from "../client/ticket-editor";
const sdk = activitySdk();
import { KanbanPanel } from "../client/kanban-panel";

const cleanups = [];
let hostSerial = 0;
let tree;
let props;
let board;
const button = (label) => tree.root.findAllByType("Pressable").find((node) => node.props.accessibilityLabel === label);
const input = (label) => tree.root.findAllByType("TextInput").find((node) => node.props.accessibilityLabel === label);
const press = async (label) => { await act(async () => { const node = button(label); expect(node).toBeDefined(); expect(node.props.disabled).not.toBe(true); node.props.onPress(); }); };
const edit = async (label, value) => { await act(async () => input(label).props.onChangeText(value)); };
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  activity.state = "active";
  props = { workspaceId: "w", host: { id: `h-${++hostSerial}` }, tab: {}, layout: { compact: false }, theme: { colors: {
    foreground: "#111", foregroundMuted: "#555", surface0: "#fff", surface1: "#eee", surface2: "#ddd", accent: "#36f", border: "#aaa", statusWarning: "#a50" } } };
  board = { kind: "ready", boardId: ticket.boardId, projectId: "p", config, tickets: [ticket] };
  rpc.set("board.read", vi.fn(async () => board));
  rpc.set("ticket.read", vi.fn(async ({ ticketId }) => ({ ...ticket, id: ticketId })));
  rpc.set("ticket.create", vi.fn(async () => ({ ...ticket, id: 5 })));
  rpc.set("ticket.update", vi.fn(async () => ticket));
  rpc.set("ticket.move", vi.fn(async () => ({ ...ticket, status: "doing" })));
  rpc.set("board.create", vi.fn(async () => board));
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; expect(activity.listeners.size).toBe(0); cleanups.splice(0).forEach((cleanup) => cleanup()); vi.useRealTimers(); rpc.clear(); });
async function editor(extra = {}) {
  const callbacks = { onClose: vi.fn(), onSaved: vi.fn() };
  const query = new BoardQuery();
  query.seed(board);
  const stop = query.activate(() => rpc.get("board.read")({ workspaceId: "w" }));
  cleanups.push(stop);
  const editorProps = { query, ticketId: 1, board, props, drafts: new Map(), ...callbacks, ...extra };
  await act(async () => { tree = create(createElement(TicketEditor, editorProps)); });
  return { ...callbacks, editorProps };
}
it("retains text and revision across polling, failed refresh and conflict reconciliation", async () => {
  const { editorProps } = await editor();
  await edit("Title", "Local draft");
  await act(async () => tree.update(createElement(TicketEditor, { ...editorProps, board: { ...board, config: { ...config }, tickets: [{ ...ticket, title: "External" }] } })));
  expect(input("Title").props.value).toBe("Local draft");
  rpc.get("ticket.update").mockResolvedValue({ kind: "error", code: "conflict", message: "Changed elsewhere", cliCode: null });
  await press("Save changes");
  expect(rpc.get("ticket.update").mock.calls[0][0].revision).toBe(ticket.revision);
  rpc.get("board.read").mockRejectedValueOnce(new Error("offline"));
  await press("Refresh saved data");
  expect(input("Title").props.value).toBe("Local draft");
  expect(button("Save changes").props.disabled).toBe(true);
  rpc.get("ticket.read").mockResolvedValue({ ...ticket, title: "External", revision: "external-hash" });
  await press("Refresh saved data");
  expect(input("Title").props.value).toBe("Local draft");
  await press("Discard draft and load saved ticket");
  expect(input("Title").props.value).toBe("External");
  await edit("Title", "Next edit");
  await press("Save changes");
  expect(rpc.get("ticket.update").mock.calls[1][0].revision).toBe("external-hash");
});
it("requires Save or Discard before launch and close", async () => {
  const onLaunch = vi.fn();
  const { onClose } = await editor({ onLaunch });
  await edit("Title", "Local draft");
  await press("Implement");
  expect(onLaunch).not.toHaveBeenCalled();
  await press("Keep editing");
  await press("Close ticket");
  expect(onClose).not.toHaveBeenCalled();
  await press("Keep editing");
  await press("Implement");
  rpc.get("ticket.update").mockResolvedValue({ ...ticket, title: "Local draft", revision: "saved" });
  await press("Save changes");
  expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ title: "Local draft", revision: "saved" }));
});
it("blocks rapid duplicate creation, shows the resulting saved ticket, and keeps move separate", async () => {
  await editor({ ticketId: "new" });
  await edit("Title", "New ticket");
  await act(async () => { const submit = button("Create ticket").props.onPress; submit(); submit(); });
  expect(rpc.get("ticket.create")).toHaveBeenCalledTimes(1);
  expect(button("Move ticket")).toBeDefined();
  await press("Move ticket");
  await press("Move to doing");
  expect(rpc.get("ticket.move")).toHaveBeenCalledExactlyOnceWith({ workspaceId: "w", ticketId: 5, revision: ticket.revision, status: "doing" });
  expect(rpc.get("ticket.update")).not.toHaveBeenCalled();
});
it("retains uncertain creation text and requires a successful read before discard", async () => {
  await editor({ ticketId: "new" });
  await edit("Title", "Unknown creation");
  rpc.get("ticket.create").mockRejectedValue(new Error("disconnected"));
  await press("Create ticket");
  await press("Close ticket");
  expect(button("Discard draft and continue").props.disabled).toBe(true);
  rpc.get("board.read").mockRejectedValueOnce(new Error("offline"));
  await press("Refresh saved data");
  expect(button("Discard draft and continue").props.disabled).toBe(true);
  expect(input("Title").props.value).toBe("Unknown creation");
  await press("Refresh saved data");
  expect(button("Create ticket").props.disabled).toBe(true);
  expect(button("Discard draft and continue").props.disabled).toBe(false);
  expect(rpc.get("ticket.create")).toHaveBeenCalledTimes(1);
});
it.each([false, true])("keeps the editor mounted through parent refresh failure, compact=%s", async (compact) => {
  props.layout.compact = compact;
  await act(async () => { tree = create(createElement(KanbanPanel, props)); });
  await press("Select ticket #1: Original, low");
  await edit("Description (Markdown)", "Unsaved body");
  rpc.get("board.read").mockRejectedValueOnce(new Error("offline"));
  await press("Refresh board");
  expect(input("Description (Markdown)").props.value).toBe("Unsaved body");
  expect(tree.root.findAllByType("Text").some((node) => node.props.children === "Board data is stale. Your draft is retained.")).toBe(true);
  const editorWrapper = tree.root.findByType(TicketEditor).parent;
  expect(editorWrapper.props.style.width).toBe(compact ? "100%" : 420);
});
it("keeps host-scoped drafts separate and restores text on remount", async () => {
  const drafts = new Map();
  const { editorProps } = await editor({ drafts });
  await edit("Title", "Host one draft");
  await act(async () => tree.update(createElement(TicketEditor, { ...editorProps, key: "h2", props: { ...props, host: { id: "h2" } } })));
  expect(input("Title").props.value).toBe("Original");
  await act(async () => tree.update(createElement(TicketEditor, { ...editorProps, key: "h1" })));
  expect(input("Title").props.value).toBe("Host one draft");
});
it.each(["light", "dark"])("uses %s theme colors, labelled inputs and visible keyboard focus", async (mode) => {
  if (mode === "dark") props.theme.colors = { ...props.theme.colors, foreground: "#eee", surface0: "#111", surface1: "#222" };
  await editor();
  for (const label of ["Title", "Description (Markdown)", "Assignee", "Tag 1", "Due date (YYYY-MM-DD)"]) {
    expect(input(label).props.style.color).toBe(props.theme.colors.foreground);
  }
  await act(async () => input("Title").props.onFocus());
  expect(input("Title").props.style.borderColor).toBe(props.theme.colors.accent);
  expect(input("Title").props.autoFocus).toBe(true);
});

it("offers board creation only for missing boards and reconciles lost creation responses", async () => {
  rpc.get("board.read").mockResolvedValue({ kind: "missing", boardId: "/board", projectId: "p" });
  rpc.get("board.create").mockRejectedValue(new Error("lost response"));
  await act(async () => { tree = create(createElement(KanbanPanel, props)); });
  await act(async () => { const submit = button("Create board").props.onPress; submit(); submit(); });
  expect(rpc.get("board.create")).toHaveBeenCalledTimes(1);
  expect(button("Create board")).toBeUndefined();
  rpc.get("board.read").mockResolvedValue(board);
  await press("Refresh board creation result");
  expect(button("New ticket")).toBeDefined();
});
it("does not offer board creation on configuration errors", async () => {
  rpc.get("board.read").mockResolvedValue({ kind: "error", code: "invalid_configuration", message: "Invalid config", cliCode: null });
  await act(async () => { tree = create(createElement(KanbanPanel, props)); });
  expect(button("Create board")).toBeUndefined();
});

it('edits literal tags individually and preserves them on unrelated saves', async () => {
  const baseline = { ...ticket, tags: ['a,"quoted"', 'two,three'] };
  rpc.get("ticket.read").mockResolvedValue(baseline);
  rpc.get("ticket.update").mockResolvedValue(baseline);
  await editor();
  expect(input("Tag 1").props.value).toBe('a,"quoted"');
  await edit("Title", "Only title");
  await press("Save changes");
  expect(rpc.get("ticket.update").mock.calls[0][0].changes).toEqual({ title: "Only title" });
  await edit("Tag 1", 'edited,"quoted"');
  await press("Remove tag 2");
  await press("Add tag");
  await edit("Tag 2", 'new,literal');
  await press("Save changes");
  expect(rpc.get("ticket.update").mock.calls[1][0].changes).toEqual({ tags: ['edited,"quoted"', 'new,literal'] });
});
it('unblocks a legacy reasonless ticket explicitly while unrelated edits preserve blocking', async () => {
  const baseline = { ...ticket, blocked: true, blockReason: null };
  rpc.get("ticket.read").mockResolvedValue(baseline);
  rpc.get("ticket.update").mockResolvedValue(baseline);
  await editor();
  expect(input("Blocked reason").props.value).toBe("");
  await edit("Description (Markdown)", "Only body");
  await press("Save changes");
  expect(rpc.get("ticket.update").mock.calls[0][0].changes).toEqual({ description: "Only body" });
  await act(async () => tree.root.findByType("SettingsSwitch").props.onValueChange(false));
  await press("Save changes");
  expect(rpc.get("ticket.update").mock.calls[1][0].changes).toEqual({ blockReason: null });
});

it("detects external Markdown changes by revision equality without replacing a draft", async () => {
  vi.useFakeTimers();
  const { editorProps } = await editor();
  await edit("Description (Markdown)", "Local unsaved Markdown");
  rpc.get("ticket.read").mockResolvedValue({ ...ticket, description: "External Markdown", revision: "000-earlier-looking-token" });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(input("Description (Markdown)").props.value).toBe("Local unsaved Markdown");
  const draft = [...editorProps.drafts.values()][0];
  expect(draft.baseline.revision).toBe("original-hash");
  expect(button("Save changes").props.disabled).toBe(true);
  expect(tree.root.findAllByType("Text").some((node) => String(node.props.children).includes("changed outside this editor"))).toBe(true);
  await press("Refresh saved data");
  await press("Discard draft and load saved ticket");
  expect(input("Description (Markdown)").props.value).toBe("External Markdown");
  expect(draft.baseline.revision).toBe("000-earlier-looking-token");
});
it("keeps the draft and disables writes when a detail refresh fails", async () => {
  vi.useFakeTimers();
  await editor();
  await edit("Title", "Local title");
  rpc.get("ticket.read").mockRejectedValueOnce(new Error("offline"));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(input("Title").props.value).toBe("Local title");
  expect(button("Save changes").props.disabled).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(button("Save changes").props.disabled).toBe(false);
});
it("ignores an old detail poll after a successful mutation", async () => {
  vi.useFakeTimers();
  await editor();
  let resolve;
  rpc.get("ticket.read").mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  await edit("Title", "Saved title");
  const saved = { ...ticket, title: "Saved title", revision: "new-hash" };
  rpc.get("ticket.update").mockResolvedValue(saved);
  rpc.get("ticket.read").mockResolvedValue(saved);
  await press("Save changes");
  await act(async () => resolve(ticket));
  expect(input("Title").props.value).toBe("Saved title");
  await edit("Title", "Next title");
  expect(button("Save changes").props.disabled).toBe(false);
});
it("transitions a created editor to its saved identity and starts the next new draft empty", async () => {
  await act(async () => { tree = create(createElement(KanbanPanel, props)); });
  await press("New ticket");
  await edit("Title", "First creation");
  rpc.get("ticket.read").mockResolvedValue({ ...ticket, id: 5, title: "First creation" });
  rpc.get("ticket.create").mockResolvedValue({ ...ticket, id: 5, title: "First creation" });
  await press("Create ticket");
  expect(tree.root.findByType(TicketEditor).props.ticketId).toBe(5);
  expect(input("Title").props.value).toBe("First creation");
  await press("Close ticket");
  await press("New ticket");
  expect(input("Title").props.value).toBe("");
  expect(button("Create ticket")).toBeDefined();
});
it("blocks sibling writes after an uncertain creation until fresh data is deliberately inspected", async () => {
  await act(async () => { tree = create(createElement("Panels", {},
    createElement(KanbanPanel, { ...props, workspaceId: "w" }),
    createElement(KanbanPanel, { ...props, workspaceId: "sibling" }))); });
  await press("New ticket");
  await edit("Title", "Possibly created");
  rpc.get("ticket.create").mockRejectedValue(new Error("response lost"));
  rpc.get("board.read").mockRejectedValue(new Error("offline"));
  await press("Create ticket");
  const newButtons = tree.root.findAllByType("Pressable").filter((node) => node.props.accessibilityLabel === "New ticket");
  expect(newButtons).toHaveLength(2);
  expect(newButtons.every((node) => node.props.disabled)).toBe(true);
  expect(button("I inspected the refreshed board").props.disabled).toBe(true);
  rpc.get("board.read").mockResolvedValue(board);
  await press("Refresh board");
  expect(newButtons.every((node) => node.props.disabled)).toBe(true);
  await press("I inspected the refreshed board");
  const siblingNew = tree.root.findAllByType("Pressable").filter((node) => node.props.accessibilityLabel === "New ticket")[1];
  expect(siblingNew.props.disabled).toBe(false);
  expect(button("Create ticket").props.disabled).toBe(true);
  expect(input("Title").props.value).toBe("Possibly created");
  expect(rpc.get("ticket.create")).toHaveBeenCalledTimes(1);
});

it("stops detail polling in the background and ignores its outstanding response", async () => {
  vi.useFakeTimers();
  await editor();
  await edit("Title", "Local text");
  let resolve;
  rpc.get("ticket.read").mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  const calls = rpc.get("ticket.read").mock.calls.length;
  await act(async () => {
    activity.state = "background";
    activity.listeners.forEach((listener) => listener("background"));
  });
  await act(async () => resolve({ ...ticket, revision: "obsolete" }));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(rpc.get("ticket.read")).toHaveBeenCalledTimes(calls);
  expect(button("Save changes").props.disabled).toBe(true);
  await act(async () => {
    activity.state = "active";
    activity.listeners.forEach((listener) => listener("active"));
  });
  expect(rpc.get("ticket.read")).toHaveBeenCalledTimes(calls + 1);
  expect(button("Save changes").props.disabled).toBe(false);
  expect(input("Title").props.value).toBe("Local text");
});
