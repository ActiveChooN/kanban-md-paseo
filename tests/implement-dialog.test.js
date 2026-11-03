import { activitySdk } from "./activity-fixtures";
import { createElement, useState } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable" }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: "Icon", Loading: "Loading", ScrollView: "ScrollView", TextInput: "TextInput",
  Modal: Object.assign(({ children, ...props }) => createElement("Modal", props, children), { Content: "ModalContent" }) }));
const rpc = vi.hoisted(() => new Map());
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => sdk, useRpc: (contract) => rpc.get(contract.name) }));
import { Picker } from "../client/design";
import { ImplementDialog } from "../client/implement-dialog";
import { canReviseLaunch, defaultLaunchPanel, launchForTicket, launchPanelSchema } from "../client/launch-state";

const scope = { hostId: "h", boardId: "/board", projectId: "p", workspaceId: "w", ticketId: 1, revision: "saved" };
const launchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const options = { kind: "launch_options", launchId, defaultWorkspace: "worktree", workspaces: ["worktree", "current"],
  instructions: "Implement #1.\n\nAcceptance criteria", providers: [
    { id: "provider", label: "Provider", models: [{ id: "model", label: "Model" }], modes: [{ id: "bypass", label: "Bypass" }], defaultModeId: "bypass" },
    { id: "other", label: "Other", models: [{ id: "other-model", label: "Other model" }], modes: [], defaultModeId: null },
  ] };
const link = { ...scope, revision: undefined, launchId, workspaceId: `kanban-${launchId}`, agentId: launchId };
delete link.revision;
const sdk = activitySdk(() => [{ ...link, launchId: persisted?.input.launchId ?? launchId, agentId: persisted?.input.launchId ?? launchId }]);
let tree, props, persisted, onLinked, onPersist;
const button = (label) => tree.root.findAllByType("Pressable").find((node) => node.props.accessibilityLabel === label);
const select = (label) => tree.root.findAllByType(Picker).find((node) => node.props.label === label);
const menuItems = () => tree.root.findAllByType("Pressable").filter((node) => node.props.accessibilityRole === "menuitem");
const instructions = () => tree.root.findByType("TextInput");
const text = () => JSON.stringify(tree.toJSON());
const press = async (label) => act(async () => {
  expect(button(label)).toBeDefined(); expect(button(label).props.disabled).not.toBe(true); button(label).props.onPress();
});
function Host(extra) {
  const [attempt, setAttempt] = useState(persisted);
  return createElement(ImplementDialog, { scope, props, attempt, canLaunch: () => true, active: true,
    onLinked, onClose: vi.fn(), onRevise: vi.fn(), onPersist: (next) => { onPersist(next); persisted = next; setAttempt(next); }, ...extra });
}
async function mount(extra = {}) { await act(async () => { tree = create(createElement(Host, extra)); }); }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  persisted = undefined; onLinked = vi.fn(); onPersist = vi.fn();
  props = { navigation: { openAgent: vi.fn() }, layout: { compact: false }, theme: { colors: {
    foreground: "#111", foregroundMuted: "#555", surface0: "#fff", surface1: "#eee", surface2: "#ddd", accent: "#36f", border: "#aaa", statusWarning: "#a50" } } };
  rpc.set("launch.options", vi.fn(async () => options));
  rpc.set("ticket.read", vi.fn(async () => ({ id: scope.ticketId, ...scope })));
  rpc.set("launch.start", vi.fn(async (input) => {
    expect(persisted.input).toEqual(input);
    return { ...link, kind: "launched", promptDelivery: "confirmed" };
  }));
  rpc.set("launch.recover", vi.fn(async () => ({ ...link, kind: "recovered", promptDelivery: "unknown" })));
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; rpc.clear(); });

it.each(["worktree", "directory"])("uses the %s default and offers the current workspace with normal permissions", async (kind) => {
  rpc.get("launch.options").mockResolvedValue({ ...options, defaultWorkspace: kind, workspaces: [kind, "current"] });
  await mount();
  expect(select("Workspace").props.value).toBe(kind);
  expect(select("Workspace").props.options.map(({ value }) => value)).toEqual([kind, "current"]);
  expect(instructions().props.value).toBe(options.instructions);
  await press(`Workspace: ${kind === "worktree" ? "New worktree" : "Project directory"}`);
  expect(menuItems().map((node) => [node.props.accessibilityLabel, node.props.accessibilityState.selected]))
    .toEqual([[kind === "worktree" ? "New worktree" : "Project directory", true], ["Current workspace", false]]);
  const onClose = vi.fn();
  await act(async () => tree.update(createElement(Host, { onClose })));
  // Escape reaches the host modal first; it must close the open menu, not the dialog.
  await act(async () => tree.root.findByType("Modal").props.onOpenChange(false));
  expect(onClose).not.toHaveBeenCalled();
  expect(menuItems()).toHaveLength(0);
  await act(async () => tree.root.findByType("Modal").props.onOpenChange(false));
  expect(onClose).toHaveBeenCalledOnce();
  await press(`Workspace: ${kind === "worktree" ? "New worktree" : "Project directory"}`);
  await act(async () => menuItems()[1].props.onPress());
  expect(menuItems()).toHaveLength(0);
  expect(button("Workspace: Current workspace")).toBeDefined();
  await press("Start implementation");
  expect(select("Workspace").props.disabled).toBe(true);
  expect(select("Workspace").props.value).toBe("current");
  expect(persisted.input).toMatchObject({ workspace: "current", modeId: null, launchId, ...scope });
  expect(props.navigation.openAgent).toHaveBeenCalledExactlyOnceWith({ serverId: "h", agentId: launchId });
  expect(onLinked).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ticketId: 1, agentId: launchId }));
});

it("persists literal input before launch, suppresses duplicate clicks, and recovers a lost response after remount", async () => {
  const literal = "  quotes ' \" $(literal) `text`\n\nKeep trailing space  ";
  rpc.get("launch.start").mockImplementation(async (input) => {
    expect(persisted.input).toEqual(input);
    throw new Error("response lost");
  });
  await mount();
  await act(async () => select("Provider").props.onValueChange("other"));
  expect(select("Model").props.value).toBe("other-model");
  await act(async () => instructions().props.onChangeText(literal));
  await act(async () => { const submit = button("Start implementation").props.onPress; submit(); submit(); });
  const input = persisted.input;
  expect(input.instructions).toBe(literal);
  expect(input.provider).toBe("other");
  expect(instructions().props.value).toBe(literal);
  expect(rpc.get("launch.start")).toHaveBeenCalledTimes(1);
  expect(button("Start implementation")).toBeUndefined();
  await act(async () => tree.unmount());
  persisted = JSON.parse(JSON.stringify(persisted));
  await mount({ canLaunch: () => false });
  expect(instructions().props.value).toBe(literal);
  expect(rpc.get("launch.options")).toHaveBeenCalledTimes(1);
  await act(async () => { const inspect = button("Inspect launch").props.onPress; inspect(); inspect(); });
  expect(rpc.get("launch.recover")).toHaveBeenCalledExactlyOnceWith(input);
  expect(rpc.get("launch.start")).toHaveBeenCalledTimes(1);
  expect(props.navigation.openAgent).toHaveBeenCalledExactlyOnceWith({ serverId: "h", agentId: launchId });
  expect(text()).toContain("Initial instruction delivery is unknown");
});

it("retains input through reconnect and recovery failure without fetching a new identity", async () => {
  rpc.get("launch.start").mockRejectedValue(new Error("offline"));
  rpc.get("launch.recover").mockRejectedValue(new Error("offline"));
  await mount(); await press("Start implementation");
  const original = persisted.input;
  await act(async () => tree.update(createElement(Host, { active: false })));
  expect(button("Inspect launch").props.disabled).toBe(true);
  await act(async () => tree.update(createElement(Host, { active: true })));
  await press("Inspect launch");
  expect(persisted.input).toEqual(original);
  expect(rpc.get("launch.options")).toHaveBeenCalledTimes(1);
  expect(rpc.get("launch.start")).toHaveBeenCalledTimes(1);
});

it("does not launch with unavailable providers, malformed choices, or a failed persistence write", async () => {
  rpc.get("launch.options").mockResolvedValueOnce({ ...options, providers: [] });
  await mount();
  expect(button("Start implementation").props.disabled).toBe(true);
  expect(text()).toContain("No available model");
  await press("Refresh launch options");
  await act(async () => select("Workspace").props.onValueChange("bad-value"));
  await press("Start implementation");
  expect(text()).toContain("Choose an available provider");
  expect(rpc.get("launch.start")).not.toHaveBeenCalled();
  await act(async () => select("Workspace").props.onValueChange("worktree"));
  onPersist.mockImplementationOnce(() => { throw new Error("storage failed"); });
  await press("Start implementation");
  expect(text()).toContain("Nothing was launched");
  expect(rpc.get("launch.start")).not.toHaveBeenCalled();
});

it.each([
  { kind: "launch_error", code: "capability_unavailable", message: "Provider became unavailable" },
  { kind: "error", code: "conflict", message: "Ticket changed", cliCode: null },
  { kind: "launch_failed", launchId, outcome: "unknown", stage: "workspace", workspaceId: null, agentId: null, message: "Creation uncertain" },
])("keeps submitted values after $kind, including validation failures", async (failure) => {
  rpc.get("launch.start").mockResolvedValue(failure);
  await mount();
  await act(async () => instructions().props.onChangeText("Keep my instructions"));
  await press("Start implementation");
  expect(persisted.result).toEqual(failure);
  expect(instructions().props.value).toBe("Keep my instructions");
  expect(text()).toContain(failure.message);
  expect(button("Inspect launch")).toBeDefined();
  expect(props.navigation.openAgent).not.toHaveBeenCalled();
});

it.each([false, true])("uses a native scrollable modal, keyboard labels and focus in compact=%s", async (compact) => {
  props.layout.compact = compact;
  await mount();
  expect(tree.root.findByType("Modal").props.title).toBe("Implement ticket #1");
  expect(tree.root.findByType("ModalContent").props.scrollable).not.toBe(false);
  expect(tree.root.findByType("ModalContent").props.contentContainerStyle.padding).toBe(compact ? 12 : 20);
  expect(instructions().props.autoFocus).toBe(true);
  expect(instructions().props.accessibilityLabel).toBe("Implementation instructions");
  await act(async () => instructions().props.onFocus());
  expect(instructions().props.style.borderColor).toBe(props.theme.colors.accent);
  await act(async () => button("Start implementation").props.onFocus());
  // Primary buttons are accent-filled, so their focus ring uses the foreground color to stay visible.
  expect(button("Start implementation").props.style.borderColor).toBe(props.theme.colors.foreground);
  expect(button("Start implementation").props.style.borderWidth).toBe(2);
});

it("retains launch state alongside old board view state and isolates host, project and workspace", () => {
  expect(launchPanelSchema.parse({ ...defaultLaunchPanel, launches: undefined }).launches).toEqual([]);
  const attempt = { input: { ...scope, launchId, workspace: "worktree", provider: "p", model: "m", modeId: null, instructions: "literal\n" }, result: null, source: "start" };
  const state = launchPanelSchema.parse({ ...defaultLaunchPanel, search: "needle", launches: [attempt] });
  expect(state.search).toBe("needle");
  expect(launchForTicket(state.launches, scope)).toEqual(attempt);
  for (const field of ["hostId", "boardId", "projectId", "workspaceId", "ticketId"]) {
    expect(launchForTicket(state.launches, { ...scope, [field]: "different" })).toBeUndefined();
  }
});

it("retries a definite rejection only with its original input and removes retry while its response is uncertain", async () => {
  rpc.get("launch.start").mockResolvedValueOnce({ kind: "launch_failed", launchId, outcome: "rejected", stage: "agent",
    workspaceId: `kanban-${launchId}`, agentId: null, message: "Creation was rejected" });
  await mount(); await press("Start implementation");
  const original = persisted.input;
  expect(button("Edit launch settings")).toBeUndefined();
  let reject;
  rpc.get("launch.start").mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await press("Retry rejected launch");
  expect(rpc.get("launch.start").mock.calls.map(([input]) => input)).toEqual([original, original]);
  expect(persisted).toEqual({ input: original, result: null, source: "retry" });
  expect(button("Retry rejected launch")).toBeUndefined();
  await act(async () => reject(new Error("response lost")));
  expect(button("Edit launch settings")).toBeUndefined();
  expect(button("Inspect launch")).toBeDefined();
});

it("never treats a recovery or retry validation error as proof the original launch was rejected", () => {
  const result = { kind: "launch_error", code: "scope_changed", message: "Changed" };
  expect(canReviseLaunch({ source: "start", result })).toBe(true);
  expect(canReviseLaunch({ source: "retry", result })).toBe(false);
  expect(canReviseLaunch({ source: "recover", result })).toBe(false);
  expect(canReviseLaunch({ source: "start", result: { kind: "recovered" } })).toBe(false);
  expect(canReviseLaunch({ source: "start", result: { kind: "launch_error", code: "identity_conflict" } })).toBe(false);
});

it("disables launch after a failed detail refresh while retaining the typed instructions", async () => {
  await mount();
  await act(async () => instructions().props.onChangeText("My draft"));
  rpc.get("ticket.read").mockResolvedValueOnce({ ...scope, id: 1, revision: "external" });
  await press("Refresh launch options");
  expect(instructions().props.value).toBe("My draft");
  expect(button("Start implementation").props.disabled).toBe(true);
  expect(rpc.get("launch.start")).not.toHaveBeenCalled();
});


it("rechecks a saved link and blocks unavailable conversations without altering the launch input", async () => {
  persisted = { input: { ...scope, launchId, workspace: "worktree", provider: "p", model: "m", modeId: null, instructions: "unchanged" },
    source: "recover", result: { ...link, kind: "recovered", promptDelivery: "unknown" } };
  const original = structuredClone(persisted.input);
  await mount();
  rpc.get("ticket.read").mockResolvedValue({ kind: "error", message: "Missing ticket" });
  await press("Open agent");
  expect(text()).toContain("Agent unavailable");
  expect(props.navigation.openAgent).not.toHaveBeenCalled();
  expect(persisted.input).toEqual(original);
  expect(rpc.get("launch.start")).not.toHaveBeenCalled();
  expect(rpc.get("launch.recover")).not.toHaveBeenCalled();
});
