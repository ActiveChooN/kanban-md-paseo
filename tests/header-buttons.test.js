import { expect, it, vi } from "vitest";
import { addKanbanHeaderButtons } from "../client/header-buttons";

function fakeClient() {
  const buttons = new Map();
  const observers = [];
  const release = vi.fn(async () => {});
  const subscription = {
    subscribe(observer) {
      observers.push(observer);
      return () => observers.splice(observers.indexOf(observer), 1);
    },
    release,
  };
  const client = {
    openPanel: vi.fn(),
    addHeaderButton(contribution) {
      expect(buttons.has(contribution.workspaceId)).toBe(false);
      buttons.set(contribution.workspaceId, contribution);
      return { update() {}, remove: () => buttons.delete(contribution.workspaceId) };
    },
    paseo: { workspaces: { list: vi.fn(async () => ({ subscription })) } },
  };
  const emit = (kind, payload) => { for (const observer of [...observers]) observer[kind](payload); };
  return { client, buttons, observers, release, emit };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const workspace = (id) => ({ id });

it("adds a header button per workspace that opens the panel and follows snapshots and updates", async () => {
  const { client, buttons, emit } = fakeClient();
  const cleanup = addKanbanHeaderButtons(client, "kanban");
  await settle();
  expect(client.paseo.workspaces.list).toHaveBeenCalledExactlyOnceWith({ subscribe: {} });

  emit("snapshot", { entries: [workspace("w1"), workspace("w2")] });
  expect([...buttons.keys()]).toEqual(["w1", "w2"]);
  const contribution = buttons.get("w1");
  expect(contribution).toMatchObject({ id: "open-kanban", button: { title: "Open Kanban", icon: "Columns3" } });
  contribution.button.behavior.onPress();
  expect(client.openPanel).toHaveBeenCalledExactlyOnceWith("kanban", { workspaceId: "w1" });

  emit("update", { type: "workspace_update", payload: { kind: "upsert", workspace: workspace("w3") } });
  emit("update", { type: "workspace_update", payload: { kind: "upsert", workspace: workspace("w1") } });
  emit("update", { type: "workspace_update", payload: { kind: "remove", id: "w2" } });
  emit("update", { type: "agent_update", payload: { kind: "remove", agentId: "w3" } });
  expect([...buttons.keys()]).toEqual(["w1", "w3"]);

  // A reconnect snapshot replaces the set.
  emit("snapshot", { entries: [workspace("w3"), workspace("w4")] });
  expect([...buttons.keys()].sort()).toEqual(["w3", "w4"]);

  cleanup();
  cleanup();
  expect(buttons.size).toBe(0);
});

it("stops observing and releases the subscription on cleanup, even before the list resolves", async () => {
  const early = fakeClient();
  early.client.paseo.workspaces.list.mockImplementation(async () => {
    await settle();
    return { subscription: { subscribe: () => { throw new Error("subscribed after cleanup"); }, release: early.release } };
  });
  addKanbanHeaderButtons(early.client, "kanban")();
  await settle();
  await settle();
  expect(early.release).toHaveBeenCalledOnce();

  const late = fakeClient();
  const cleanup = addKanbanHeaderButtons(late.client, "kanban");
  await settle();
  expect(late.observers).toHaveLength(1);
  cleanup();
  expect(late.observers).toHaveLength(0);
  expect(late.release).toHaveBeenCalledOnce();
});

it("logs instead of throwing when the workspace list fails", async () => {
  const { client, buttons } = fakeClient();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  client.paseo.workspaces.list.mockRejectedValue(new Error("offline"));
  addKanbanHeaderButtons(client, "kanban");
  await settle();
  expect(buttons.size).toBe(0);
  expect(error).toHaveBeenCalledOnce();
  error.mockRestore();
});
