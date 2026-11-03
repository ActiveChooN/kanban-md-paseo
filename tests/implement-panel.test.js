import { activitySdk } from "./activity-fixtures";
import { createElement, useState } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { config, ticket } from "./ticket-fixtures";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable",
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: "Icon", Loading: "Loading", Markdown: "Markdown", ScrollView: "ScrollView", SettingsSelect: "SettingsSelect", SettingsSwitch: "SettingsSwitch", TextInput: "TextInput",
  Modal: Object.assign(({ children, ...props }) => createElement("Modal", props, children), { Content: "ModalContent" }) }));
const rpc = vi.hoisted(() => new Map());
vi.mock("@getpaseo/plugin/client", async () => ({ usePaseo: () => sdk, useRpc: (contract) => rpc.get(contract.name),
  useHosts: () => [{ serverId: props.host.id, status: "online" }], useWorkspace: () => null,
  // Load the installed hook itself; a synchronous stub would conceal a deferred SDK write.
  useTabState: (await import("../node_modules/@getpaseo/plugin/dist/client/tab.js")).useTabState }));
import { KanbanPanel } from "../client/kanban-panel";
import { getBoardQuery } from "../client/board-query";
import { boardQueryKey } from "../client/board-view";

let sdk = activitySdk(() => (persisted?.launches ?? []).map(({ input }) => linked(input)));
let tree, props, persisted, board, hostSerial = 0;
const launchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const nextId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const options = { kind: "launch_options", launchId, defaultWorkspace: "worktree", workspaces: ["worktree", "current"], instructions: "Implement #1",
  providers: [{ id: "p", label: "Provider", models: [{ id: "m", label: "Model" }], modes: [], defaultModeId: null }] };
const button = (label) => tree.root.findAllByType("Pressable").find((node) => node.props.accessibilityLabel === label);
const input = (label) => tree.root.findAllByType("TextInput").find((node) => node.props.accessibilityLabel === label);
const press = async (label) => act(async () => { expect(button(label)).toBeDefined(); expect(button(label).props.disabled).not.toBe(true); button(label).props.onPress(); });
const edit = async (label, value) => act(async () => input(label).props.onChangeText(value));
function Host() {
  const [state, setState] = useState(persisted);
  return createElement(KanbanPanel, { ...props, tab: { state, setState: (next) => { persisted = next; setState(next); } } });
}
const linked = (input) => ({ hostId: input.hostId, boardId: input.boardId, projectId: input.projectId, ticketId: input.ticketId,
  launchId: input.launchId, agentId: input.launchId, workspaceId: `kanban-${input.launchId}` });
async function mount() { await act(async () => { tree = create(createElement(Host)); }); }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  persisted = undefined;
  sdk = activitySdk(() => (persisted?.launches ?? []).map(({ input }) => linked(input)));
  props = { workspaceId: "w", host: { id: `implementation-${++hostSerial}` }, navigation: { openAgent: vi.fn() }, layout: { compact: false }, theme: { colors: {
    foreground: "#111", foregroundMuted: "#555", surface0: "#fff", surface1: "#eee", surface2: "#ddd", accent: "#36f", border: "#aaa", statusWarning: "#a50" } } };
  board = { kind: "ready", boardId: ticket.boardId, projectId: ticket.projectId, config, tickets: [ticket] };
  rpc.set("board.read", vi.fn(async () => board));
  rpc.set("ticket.read", vi.fn(async () => ticket));
  rpc.set("ticket.update", vi.fn(async () => ticket));
  rpc.set("launch.options", vi.fn(async () => options));
  rpc.set("launch.start", vi.fn(async (input) => {
    expect(persisted.launches.find(({ input: saved }) => saved.launchId === input.launchId).input).toEqual(input);
    return { kind: "launched", promptDelivery: "confirmed", ...linked(input) };
  }));
  rpc.set("launch.recover", vi.fn(async (input) => ({ kind: "recovered", promptDelivery: "unknown", ...linked(input) })));
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; rpc.clear(); });

it("launches directly from a card, refreshes its link, and keeps filters alongside recovery through remount", async () => {
  rpc.get("launch.start").mockRejectedValueOnce(new Error("lost response"));
  await mount();
  await edit("Search tickets by ID or title", "Original");
  await press("Implement #1");
  await edit("Implementation instructions", "literal\n  instructions");
  await press("Start implementation");
  expect(persisted.search).toBe("Original");
  const original = persisted.launches[0].input;
  await press("Close implementation");
  await press("Clear filters");
  expect(persisted.launches[0].input).toEqual(original);
  await act(async () => tree.unmount());
  await mount();
  await press("Inspect launch #1");
  expect(input("Implementation instructions").props.value).toBe(original.instructions);
  const reads = rpc.get("board.read").mock.calls.length;
  await press("Inspect launch");
  expect(rpc.get("launch.recover")).toHaveBeenCalledExactlyOnceWith(original);
  expect(rpc.get("launch.start")).toHaveBeenCalledTimes(1);
  expect(rpc.get("board.read").mock.calls.length).toBeGreaterThan(reads);
  expect(props.navigation.openAgent).toHaveBeenCalledExactlyOnceWith({ serverId: props.host.id, agentId: launchId });
  await press("Close implementation");
  await press("Open agent for #1");
  expect(props.navigation.openAgent).toHaveBeenCalledTimes(2);
});

it.each(["save", "discard"])("requires %s before opening launch from a dirty editor", async (action) => {
  await mount();
  await press("Select ticket #1: Original, low");
  await edit("Title", "Draft title");
  await press("Implement");
  expect(rpc.get("launch.options")).not.toHaveBeenCalled();
  // The open ticket's card launches through the same Save/Discard prompt as the editor's Implement button.
  await press("Keep editing");
  await press("Implement #1");
  expect(rpc.get("launch.options")).not.toHaveBeenCalled();
  expect(button("Keep editing")).toBeDefined();
  if (action === "save") {
    const saved = { ...ticket, title: "Draft title", revision: "saved-revision" };
    rpc.get("ticket.update").mockResolvedValue(saved);
    rpc.get("ticket.read").mockResolvedValue(saved);
    await press("Save changes");
    expect(rpc.get("launch.options")).toHaveBeenCalledWith(expect.objectContaining({ revision: "saved-revision" }));
  } else {
    await press("Discard draft and continue");
    expect(rpc.get("ticket.update")).not.toHaveBeenCalled();
    expect(rpc.get("launch.options")).toHaveBeenCalledWith(expect.objectContaining({ revision: ticket.revision }));
  }
  await press("Close implementation");
  expect(button("Keep editing")).toBeUndefined();
  await edit("Description (Markdown)", "Another edit");
  await press("Save changes");
  expect(tree.root.findAllByType("Modal")).toHaveLength(0);
});

it("allows launch inspection while ticket writes are uncertain", async () => {
  rpc.get("launch.start").mockRejectedValue(new Error("lost"));
  await mount(); await press("Implement #1"); await press("Start implementation"); await press("Close implementation");
  const query = getBoardQuery(boardQueryKey(props.host.id, board.boardId));
  await act(async () => { query.beginWrite(); query.endWrite(true); });
  expect(query.canWrite).toBe(false);
  await press("Inspect launch #1"); await press("Inspect launch");
  expect(rpc.get("launch.recover")).toHaveBeenCalledTimes(1);
  expect(query.canWrite).toBe(false);
});

it("creates a deliberate new intent after validation failure while preserving the original input", async () => {
  rpc.get("launch.start").mockResolvedValueOnce({ kind: "launch_error", code: "capability_unavailable", message: "Unavailable" });
  await mount(); await press("Implement #1");
  await edit("Implementation instructions", "  retained\ntext  ");
  await press("Start implementation");
  const original = persisted.launches[0].input;
  rpc.get("launch.options").mockResolvedValue({ ...options, launchId: nextId });
  await press("Edit launch settings");
  expect(input("Implementation instructions").props.value).toBe(original.instructions);
  await press("Start implementation");
  expect(persisted.launches).toHaveLength(2);
  expect(persisted.launches[0].input).toEqual(original);
  expect(persisted.launches[1].input.launchId).toBe(nextId);
  expect(props.navigation.openAgent).toHaveBeenCalledExactlyOnceWith({ serverId: props.host.id, agentId: nextId });
});

it("hides launch on apps without native conversation navigation", async () => {
  props.navigation = undefined;
  await mount();
  expect(button("Implement #1")).toBeUndefined();
  await press("Select ticket #1: Original, low");
  expect(button("Implement")).toBeUndefined();
});

it.each([false, true])("renders status navigation, theme colors and focus with compact=%s", async (compact) => {
  props.layout.compact = compact;
  props.theme.colors = { ...props.theme.colors, foreground: "#eee", surface0: "#111", surface1: "#222" };
  board.tickets.push({ ...ticket, id: 2, title: "Working", status: "doing" });
  await mount();
  const card = (id) => tree.root.findAllByType("Pressable").find((node) => node.props.accessibilityLabel?.startsWith(`Select ticket #${id}:`));
  expect(card(1)).toBeDefined();
  expect(!!card(2)).toBe(!compact);
  await act(async () => button("doing · 1").props.onFocus());
  expect(button("doing · 1").props.style.borderColor).toBe(props.theme.colors.accent);
  await press("doing · 1");
  expect(card(2)).toBeDefined();
  expect(!!card(1)).toBe(!compact);
  expect(button("doing · 1").props.accessibilityState.selected).toBe(true);
  expect(input("Search tickets by ID or title").props.style.color).toBe(props.theme.colors.foreground);
  await act(async () => tree.unmount());
  await mount();
  expect(button("doing · 1").props.accessibilityState.selected).toBe(true);
});

it("retains a pending launch when dismissed and does not navigate or overwrite newer filters on completion", async () => {
  let complete;
  rpc.get("launch.start").mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  await mount(); await press("Implement #1"); await press("Start implementation");
  const original = persisted.launches[0].input;
  expect(persisted.launches[0].result).toBeNull();
  await press("Close implementation");
  await edit("Search tickets by ID or title", "Original");
  await act(async () => complete({ kind: "launched", promptDelivery: "confirmed", ...linked(original) }));
  expect(persisted.search).toBe("Original");
  expect(persisted.launches[0].input).toEqual(original);
  expect(button("Open agent for #1")).toBeDefined();
  expect(props.navigation.openAgent).not.toHaveBeenCalled();
});

it("allows inspection of a linked agent with dirty edits but blocks a new implementation until those edits are resolved", async () => {
  await mount(); await press("Implement #1"); await press("Start implementation"); await press("Close implementation");
  await press("Select ticket #1: Original, low");
  await edit("Title", "Unsaved work");
  await press("Inspect ticket launch");
  expect(button("Open agent").props.disabled).toBe(false);
  expect(button("New implementation").props.disabled).toBe(true);
  expect(rpc.get("launch.start")).toHaveBeenCalledTimes(1);
});


it("discovers historical sessions without tab history, shows transitions, and never completes a ticket or sends prompts", async () => {
  vi.useFakeTimers();
  try {
    const historical = [launchId, nextId].map((id) => linked({ hostId: props.host.id, boardId: board.boardId, projectId: board.projectId, ticketId: 1, launchId: id }));
    sdk = activitySdk(() => historical);
    const originalRef = sdk.agents.ref;
    let status = "running", attentionReason = null, archivedAt = null;
    sdk.agents.ref = vi.fn((id) => ({ refresh: async () => {
      const result = await originalRef(id).refresh();
      return { agent: { ...result.agent, status, attentionReason, archivedAt } };
    } }));
    await mount();
    expect(JSON.stringify(tree.toJSON())).toContain("Running · 2 sessions");
    await press("Select ticket #1: Original, low");
    expect(button(`Open agent ${launchId}`)).toBeDefined();
    expect(button(`Open agent ${nextId}`)).toBeDefined();
    await press(`Open agent ${nextId}`);
    expect(props.navigation.openAgent).toHaveBeenLastCalledWith({ serverId: props.host.id, agentId: nextId });
    attentionReason = "permission";
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(JSON.stringify(tree.toJSON())).toContain("Needs input · 2 sessions");
    status = "error"; attentionReason = "error";
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(JSON.stringify(tree.toJSON())).toContain("Error · 2 sessions");
    status = "idle"; attentionReason = "finished";
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(JSON.stringify(tree.toJSON())).toContain("Idle · 2 sessions");
    archivedAt = "today";
    await press(`Open agent ${nextId}`);
    expect(props.navigation.openAgent).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tree.toJSON())).toContain("Agent unavailable");
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(button(`Open agent ${nextId}`).props.disabled).toBe(true);
    expect(board.tickets[0].status).toBe(ticket.status);
    expect(rpc.get("ticket.update")).not.toHaveBeenCalled();
    expect(rpc.get("launch.start")).not.toHaveBeenCalled();
    expect(rpc.get("launch.recover")).not.toHaveBeenCalled();
    expect(persisted.launches).toHaveLength(0);
    await act(async () => tree.unmount()); tree = undefined;
    archivedAt = null;
    await mount();
    expect(JSON.stringify(tree.toJSON())).toContain("Idle · 2 sessions");
  } finally { await act(async () => tree.unmount()); tree = undefined; vi.useRealTimers(); }
});

it("filters through the compact filter bar and keeps active filters as chips when it is hidden", async () => {
  board.tickets.push({ ...ticket, id: 2, title: "Second", priority: "urgent", assignee: null, tags: [] });
  await mount();
  const items = () => tree.root.findAllByType("Pressable").filter((node) => node.props.accessibilityRole === "menuitem");
  await press("Show filters");
  expect(["Status: All", "Priority: All", "Assignee: All", "Tag: All", "Blocking: All"].every((label) => button(label))).toBe(true);
  expect(button("Clear filters")).toBeUndefined();
  await press("Priority: All");
  expect(items().map((node) => node.props.accessibilityLabel)).toEqual(["All", "low", "urgent"]);
  await act(async () => items()[2].props.onPress());
  await press("Assignee: All");
  expect(items().map((node) => node.props.accessibilityLabel)).toEqual(["All", "Unassigned", "Ada"]);
  await act(async () => items()[1].props.onPress());
  expect(persisted).toMatchObject({ priority: "urgent", assignee: "unassigned" });
  expect(button("Select ticket #1: Original, low")).toBeUndefined();
  expect(button("Select ticket #2: Second, urgent")).toBeDefined();
  expect(button("Remove Priority: urgent")).toBeDefined();
  await press("Remove Assignee: Unassigned");
  expect(persisted.assignee).toBe("");
  await press("Hide filters");
  expect(button("Priority: urgent")).toBeUndefined();
  await press("Remove Priority: urgent");
  expect(persisted.priority).toBe("");
  await edit("Search tickets by ID or title", "Sec");
  await press("Show filters");
  await press("Clear filters");
  expect(persisted).toMatchObject({ search: "", priority: "", assignee: "", status: "", tag: "", blocked: "all" });
});

const second = { ...ticket, id: 2, title: "Second", priority: "urgent", revision: "second-hash" };
const card = (id) => tree.root.findAllByType("Pressable").find((node) => node.props.accessibilityLabel?.startsWith(`Select ticket #${id}:`));
const openTicket = () => tree.root.findAllByType("Text").find((node) => node.props.accessibilityRole === "header" && node.props.accessibilityLabel?.startsWith("Ticket #"))?.props.accessibilityLabel;
const pressCard = async (id) => act(async () => { expect(card(id).props.disabled).toBe(false); card(id).props.onPress(); });
function withSecondTicket() {
  board.tickets.push(second);
  rpc.set("ticket.read", vi.fn(async ({ ticketId }) => ticketId === 2 ? second : ticket));
}

it("switches the open ticket from a card when the draft is clean", async () => {
  withSecondTicket();
  await mount();
  await pressCard(1);
  expect(card(1).props.accessibilityState.selected).toBe(true);
  await pressCard(2);
  expect(openTicket()).toBe("Ticket #2");
  expect(input("Title").props.value).toBe("Second");
  expect(button("Keep editing")).toBeUndefined();
  expect(card(2).props.accessibilityState.selected).toBe(true);
  expect(card(1).props.accessibilityState.selected).toBe(false);
  expect(persisted.selectedTicket).toBe(2);
  await press("New ticket");
  expect(button("Create ticket")).toBeDefined();
  expect(persisted.selectedTicket).toBeNull();
});

it("asks before switching from a dirty draft and opens the clicked ticket after discard", async () => {
  withSecondTicket();
  await mount();
  await pressCard(1);
  await edit("Title", "Unsaved title");
  await pressCard(2);
  expect(openTicket()).toBe("Ticket #1");
  expect(input("Title").props.value).toBe("Unsaved title");
  await press("Discard draft and continue");
  expect(openTicket()).toBe("Ticket #2");
  expect(input("Title").props.value).toBe("Second");
  await pressCard(1);
  expect(input("Title").props.value).toBe("Original");
  expect(rpc.get("ticket.update")).not.toHaveBeenCalled();
});

it("keeps the dirty draft when switching is declined, and saving continues to the clicked ticket", async () => {
  withSecondTicket();
  await mount();
  await pressCard(1);
  await edit("Title", "Kept title");
  await pressCard(2);
  await press("Keep editing");
  expect(openTicket()).toBe("Ticket #1");
  expect(input("Title").props.value).toBe("Kept title");
  await press("New ticket");
  expect(button("Create ticket")).toBeUndefined();
  await press("Keep editing");
  await pressCard(2);
  const saved = { ...ticket, title: "Kept title", revision: "saved-revision" };
  rpc.get("ticket.update").mockResolvedValue(saved);
  await press("Save changes");
  expect(rpc.get("ticket.update")).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ticketId: 1, changes: { title: "Kept title" } }));
  expect(openTicket()).toBe("Ticket #2");
});

it("blocks switching while a save is in flight", async () => {
  withSecondTicket();
  let finish;
  rpc.get("ticket.update").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount();
  await pressCard(1);
  await edit("Title", "Saving title");
  await press("Save changes");
  expect(card(2).props.disabled).toBe(true);
  expect(button("New ticket").props.disabled).toBe(true);
  await act(async () => card(2).props.onPress());
  expect(openTicket()).toBe("Ticket #1");
  expect(button("Keep editing")).toBeUndefined();
  await act(async () => finish({ ...ticket, title: "Saving title", revision: "saved-revision" }));
  rpc.get("ticket.read").mockImplementation(async ({ ticketId }) => ticketId === 2 ? second : { ...ticket, title: "Saving title", revision: "saved-revision" });
  await act(async () => { await getBoardQuery(boardQueryKey(props.host.id, board.boardId)).refresh(true); });
  await pressCard(2);
  expect(openTicket()).toBe("Ticket #2");
});

it("resolves the open draft before implementing another ticket from its card", async () => {
  withSecondTicket();
  await mount();
  await pressCard(1);
  await edit("Title", "Unsaved title");
  await press("Implement #2");
  expect(rpc.get("launch.options")).not.toHaveBeenCalled();
  await press("Discard draft and continue");
  expect(rpc.get("launch.options")).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 2 }));
  expect(openTicket()).toBe("Ticket #1");
  expect(input("Title").props.value).toBe("Original");
});

it("returns focus to the closed ticket's card, and nowhere when it is filtered out or on mount", async () => {
  withSecondTicket();
  const focused = [];
  await act(async () => { tree = create(createElement(Host), { createNodeMock: (element) => ({ focus: () => focused.push(element.props.accessibilityLabel) }) }); });
  expect(focused).toEqual([]);
  await pressCard(2);
  await press("Close ticket");
  expect(focused).toEqual(["Select ticket #2: Second, urgent"]);
  await pressCard(1);
  await edit("Search tickets by ID or title", "Second");
  await press("Close ticket");
  expect(focused).toHaveLength(1);
  await press("New ticket");
  await press("Close ticket");
  expect(focused).toHaveLength(1);
});

it("returns focus to a card that reaches the board shortly after close, but not once the request expires", async () => {
  withSecondTicket();
  const focused = [];
  await act(async () => { tree = create(createElement(Host), { createNodeMock: (element) => ({ focus: () => focused.push(element.props.accessibilityLabel) }) }); });
  const refresh = () => act(async () => { await getBoardQuery(boardQueryKey(props.host.id, board.boardId)).refresh(true); });
  const close = async () => { board.tickets = [ticket]; await refresh(); await press("Close ticket"); };
  await pressCard(2);
  // Like a just-created ticket: the board does not list it yet when the editor closes.
  await close();
  expect(focused).toEqual([]);
  board.tickets = [ticket, second];
  await refresh();
  expect(focused).toEqual(["Select ticket #2: Second, urgent"]);
  await pressCard(2);
  await close();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 5000);
  try {
    board.tickets = [ticket, second];
    await refresh();
    expect(focused).toHaveLength(1);
  } finally { clock.mockRestore(); }
});
