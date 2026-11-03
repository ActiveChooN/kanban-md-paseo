import { createElement, StrictMode } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { config, ticket } from "./ticket-fixtures";
const runtime = vi.hoisted(() => ({ hosts: [], project: null, projects: new Map(), reads: new Map(), listeners: new Set(), app: "active" }));
vi.mock("react-native", () => ({ AppState: {
  get currentState() { return runtime.app; },
  addEventListener: (_name, listener) => { runtime.listeners.add(listener); return { remove: () => runtime.listeners.delete(listener) }; },
} }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => runtime.reads.get(runtime.host), useHosts: () => runtime.hosts,
  useWorkspace: (id, select) => { const project = runtime.projects.get(id) ?? runtime.project; return project ? select(project) : null; },
}));
import { useBoard } from "../client/use-board";
const board = { kind: "ready", boardId: ticket.boardId, projectId: "p", config, tickets: [ticket] };
const results = new Map();
const trees = [];
function Probe({ host = "h", workspace = "w", name = "one" }) {
  runtime.host = host;
  results.set(name, useBoard(host, workspace));
  return null;
}
async function mount(props = {}) {
  let tree;
  await act(async () => { tree = create(createElement(Probe, props)); });
  trees.push(tree);
  return tree;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  runtime.hosts = [{ serverId: "h", status: "online" }, { serverId: "other", status: "online" }];
  runtime.app = "active";
  runtime.projects.clear();
  runtime.project = { projectId: "p", projectRootPath: "/project" };
  runtime.reads.set("h", vi.fn(async () => board));
  runtime.reads.set("other", vi.fn(async () => ({ ...board, config: { ...config, name: "Other host" } })));
});
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
  expect(runtime.listeners.size).toBe(0);
  vi.useRealTimers(); runtime.reads.clear(); results.clear();
});
it("shares physical-board polling across sibling workspaces, including differing project metadata", async () => {
  vi.useFakeTimers();
  await mount();
  runtime.projects.set("w", runtime.project);
  runtime.project = { projectId: "alias", projectRootPath: "/symlink" };
  await mount({ workspace: "sibling", name: "two" });
  expect(results.get("one").query).toBe(results.get("two").query);
  const read = runtime.reads.get("h");
  expect(read).toHaveBeenCalledTimes(2); // One discovery per distinct project identity.
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(read).toHaveBeenCalledTimes(4);
});
it("coalesces sibling discovery and keeps equal board paths on different hosts separate", async () => {
  const pending = deferred();
  runtime.reads.get("h").mockReturnValue(pending.promise);
  await mount();
  await mount({ workspace: "sibling", name: "two" });
  expect(runtime.reads.get("h")).toHaveBeenCalledTimes(1);
  await mount({ host: "other", name: "three" });
  await act(async () => pending.resolve(board));
  expect(results.get("one").query).toBe(results.get("two").query);
  expect(results.get("one").query).not.toBe(results.get("three").query);
  expect(results.get("three").lastReady.config.name).toBe("Other host");
});
it("stops in the background and refreshes on foreground, disconnect and reconnect", async () => {
  vi.useFakeTimers();
  const tree = await mount();
  const read = runtime.reads.get("h");
  const initial = read.mock.calls.length;
  await act(async () => {
    runtime.app = "background";
    runtime.listeners.forEach((listener) => listener("background"));
  });
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(read).toHaveBeenCalledTimes(initial);
  expect(results.get("one").query.canWrite).toBe(false);
  await act(async () => {
    runtime.app = "active";
    runtime.listeners.forEach((listener) => listener("active"));
  });
  expect(read).toHaveBeenCalledTimes(initial + 1);
  runtime.hosts = [{ serverId: "h", status: "offline" }];
  await act(async () => tree.update(createElement(Probe)));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(read).toHaveBeenCalledTimes(initial + 1);
  expect(results.get("one").active).toBe(false);
  runtime.hosts = [{ serverId: "h", status: "online" }];
  await act(async () => tree.update(createElement(Probe)));
  expect(read).toHaveBeenCalledTimes(initial + 2);
  expect(results.get("one").query.canWrite).toBe(true);
});
it("ignores old-host responses after switching hosts", async () => {
  const old = deferred();
  runtime.reads.get("h").mockReturnValue(old.promise);
  const tree = await mount();
  await act(async () => tree.update(createElement(Probe, { host: "other" })));
  await act(async () => old.resolve(board));
  expect(results.get("one").lastReady.config.name).toBe("Other host");
});
it("ignores old-project responses when the same workspace changes project", async () => {
  const old = deferred();
  runtime.reads.get("h").mockReturnValueOnce(old.promise);
  const tree = await mount();
  runtime.project = { projectId: "next", projectRootPath: "/next" };
  runtime.reads.get("h").mockResolvedValue({ ...board, boardId: "/next/kanban", projectId: "next" });
  await act(async () => tree.update(createElement(Probe)));
  await act(async () => old.resolve(board));
  expect(results.get("one").lastReady.boardId).toBe("/next/kanban");
});
it("cleans up timers and subscriptions on unmount", async () => {
  vi.useFakeTimers();
  const tree = await mount();
  await act(async () => tree.unmount());
  expect(vi.getTimerCount()).toBe(0);
  expect(runtime.listeners.size).toBe(0);
});

it("cleans up the rehearsal mount in React StrictMode without duplicate pollers", async () => {
  vi.useFakeTimers();
  let tree;
  await act(async () => { tree = create(createElement(StrictMode, {}, createElement(Probe))); });
  trees.push(tree);
  expect(results.get("one").lastReady).toEqual(board);
  expect(vi.getTimerCount()).toBe(1);
  const read = runtime.reads.get("h");
  const initial = read.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(read).toHaveBeenCalledTimes(initial + 1);
});
it("shows an offline state without starting reads when the panel opens disconnected", async () => {
  runtime.hosts = [{ serverId: "h", status: "offline" }];
  await mount();
  expect(runtime.reads.get("h")).not.toHaveBeenCalled();
  expect(results.get("one").data.kind).toBe("transport-error");
});
