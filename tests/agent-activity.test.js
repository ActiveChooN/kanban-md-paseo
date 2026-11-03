import { createElement, StrictMode } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activitySdk } from "./activity-fixtures";
import { agentActivity, discoverSessions, readSession } from "../client/agent-activity";

vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => sdk, useRpc: () => readTicket }));
import { useAgentActivity, useValidatedAgent } from "../client/use-agent-activity";

const scope = { hostId: "h", boardId: "/board", projectId: "p" };
const link = { ...scope, workspaceId: "w", ticketId: 1, launchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const second = { ...link, launchId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
let sdk, readTicket, tree, latest, validate, entries;
function Harness({ selected = scope, active = true, known = [], ids = [1] }) {
  latest = useAgentActivity(selected, ids, known, active);
  validate = useValidatedAgent({ ...selected, workspaceId: "origin" }, active);
  return null;
}
async function mount(props = {}) { await act(async () => { tree = create(createElement(StrictMode, null, createElement(Harness, props))); }); }
async function update(props) { await act(async () => tree.update(createElement(StrictMode, null, createElement(Harness, props)))); }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); entries = [link, second]; sdk = activitySdk(() => entries);
  readTicket = vi.fn(async () => ({ id: 1, boardId: scope.boardId, projectId: scope.projectId }));
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; vi.useRealTimers(); });

it.each([
  ["initializing", null, [], "Running"], ["running", null, [], "Running"],
  ["running", "permission", [], "Needs input"], ["running", null, [{}], "Needs input"],
  ["error", "permission", [], "Needs input"], ["error", null, [], "Error"],
  ["running", "error", [], "Error"], ["idle", "finished", [], "Idle"], ["idle", null, [], "Idle"],
])("derives %s / %s without workflow state", (status, attentionReason, pendingPermissions, expected) => {
  expect(agentActivity({ status, attentionReason, pendingPermissions })).toBe(expected);
});

it("discovers multiple histories after reload with a single label-filtered paginated scan", async () => {
  const all = await sdk.agents.list(); sdk.agents.list.mockClear();
  sdk.agents.list.mockResolvedValueOnce({ entries: [all.entries[0]], pageInfo: { hasMore: true, nextCursor: "next" } })
    .mockResolvedValueOnce({ entries: [all.entries[1]], pageInfo: { hasMore: false, nextCursor: null } });
  const sessions = await discoverSessions(sdk, scope, [1], [], () => true);
  expect(sessions.map(({ link }) => link.agentId)).toEqual([link.agentId, second.agentId]);
  expect(sdk.agents.list).toHaveBeenCalledTimes(2);
  expect(sdk.agents.list.mock.calls[0][0]).toMatchObject({ filter: { labels: { "kanban.host": "h", "kanban.board": "/board", "kanban.project": "p" }, includeArchived: true } });
  expect(sdk.agents.list.mock.calls[1][0].page.cursor).toBe("next");
  expect(sdk.agents.list.mock.calls[0][0].subscribe).toBeUndefined();
});

it.each(["host", "board", "project", "ticket", "workspace", "launch", "archived", "closed", "missing", "missing workspace", "workspace project", "archiving"])("rejects %s mismatches or unavailable resources", async (kind) => {
  const base = sdk.agents.ref(link.agentId);
  const result = await base.refresh();
  if (["host", "board", "project", "ticket", "workspace", "launch"].includes(kind)) result.agent.labels[`kanban.${kind}`] = "wrong";
  if (kind === "archived") result.agent.archivedAt = "today";
  if (kind === "closed") result.agent.status = "closed";
  sdk.agents.ref = vi.fn(() => ({ refresh: async () => kind === "missing" ? null : result }));
  if (kind === "missing workspace") sdk.workspaces.ref = () => ({ refresh: async () => null });
  if (kind === "workspace project") sdk.workspaces.ref = () => ({ refresh: async () => ({ id: "w", projectId: "other" }) });
  if (kind === "archiving") sdk.workspaces.ref = () => ({ refresh: async () => ({ id: "w", projectId: "p", archivingAt: "today" }) });
  expect((await readSession(sdk, scope, link)).activity).toBe("Unavailable");
});

it("retains missing history, pauses in background, resumes, and releases timers on unmount", async () => {
  await mount();
  expect(latest.sessions).toHaveLength(2);
  entries = [];
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(latest.sessions.map(({ activity }) => activity)).toEqual(["Unavailable", "Unavailable"]);
  await update({ active: false });
  const reads = sdk.agents.list.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(sdk.agents.list).toHaveBeenCalledTimes(reads);
  entries = [link];
  await update({ active: true });
  expect(latest.sessions.find(({ link: candidate }) => candidate.agentId === link.agentId).activity).toBe("Idle");
  await act(async () => tree.unmount()); tree = undefined;
  expect(vi.getTimerCount()).toBe(0);
});

it("ignores late host responses and never validates navigation from the old host", async () => {
  let resolve;
  sdk.agents.list.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await mount();
  let finishTicket;
  readTicket.mockImplementationOnce(() => new Promise((done) => { finishTicket = done; }));
  const pending = validate(link);
  await update({ selected: { ...scope, hostId: "other-host" } });
  await act(async () => resolve({ entries: [], pageInfo: { hasMore: false } }));
  finishTicket({ id: 1, boardId: scope.boardId, projectId: scope.projectId });
  expect(await pending).toBe(false);
  expect(latest.sessions).toEqual([]);
  expect(await validate(link)).toBe(false);
});

it("validates the current ticket before navigation and fails closed on read errors", async () => {
  await mount();
  expect(await validate(link)).toBe(true);
  for (const ticket of [{ kind: "error" }, { id: 2, boardId: "/board", projectId: "p" }, { id: 1, boardId: "/else", projectId: "p" }, { id: 1, boardId: "/board", projectId: "other" }]) {
    readTicket.mockResolvedValueOnce(ticket);
    expect(await validate(link)).toBe(false);
  }
  sdk.agents.list.mockRejectedValue(new Error("offline"));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(latest.unavailable).toBe(true);
  expect(latest.sessions.every(({ activity }) => activity === "Unavailable")).toBe(true);
});

it("reads only visible ticket sessions and disposes an in-flight scan before fetching snapshots", async () => {
  entries = [link, { ...second, ticketId: 2 }];
  await mount();
  expect(sdk.agents.ref.mock.calls.every(([id]) => id === link.agentId)).toBe(true);
  await act(async () => tree.unmount()); tree = undefined;
  sdk.agents.ref.mockClear();
  let finish;
  sdk.agents.list.mockImplementation(() => new Promise((done) => { finish = done; }));
  await mount();
  await act(async () => tree.unmount()); tree = undefined;
  await act(async () => finish({ entries: [], pageInfo: { hasMore: false } }));
  expect(sdk.agents.ref).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});


it("keeps a saved workspace association when directory labels change", async () => {
  entries = [{ ...link, workspaceId: "moved" }];
  const sessions = await discoverSessions(sdk, scope, [1], [link], () => true);
  expect(sessions).toEqual([{ link, activity: "Unavailable" }]);
});

it("does no directory work when no tickets are visible", async () => {
  await mount({ ids: [] });
  expect(sdk.agents.list).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
