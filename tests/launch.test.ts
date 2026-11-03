import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLaunchOptions, recoverLaunch, startLaunch, type LaunchPaseo } from "../server/launch";
import { readTicket } from "../server/reads";
import { launchInputSchema, launchLabelKeys, launchOptions, launchResultSchema, type LaunchInput } from "../shared/launch";
import { WorkspaceCreateRequestSchema } from "@getpaseo/protocol/messages";
import { ticketDetailSchema } from "../shared/ticket";

type Workspace = NonNullable<Awaited<ReturnType<ReturnType<LaunchPaseo["workspaces"]["ref"]>["refresh"]>>>;
type Agent = NonNullable<Awaited<ReturnType<ReturnType<LaunchPaseo["agents"]["ref"]>["refresh"]>>>;
type Create = Parameters<LaunchPaseo["workspaces"]["create"]>[0];
type CreateAgent = Parameters<ReturnType<LaunchPaseo["workspaces"]["ref"]>["agents"]["create"]>[0];

let root: string;
let input: LaunchInput;
let fixture: ReturnType<typeof sdk>;
const body = "Description with 'quotes' and $(literal).\n\n## Acceptance criteria\n- Keep canonical ownership.";

function cli(...args: string[]) {
  // Decline init's ignore-file prompt without a terminal and capture its stderr.
  return execFileSync("kanban-md", ["--dir", join(root, "kanban"), ...args], {
    encoding: "utf8", cwd: root, input: "n\n", stdio: ["pipe", "pipe", "pipe"],
  });
}

function sdk() {
  const workspace = (id: string): Workspace => ({
    id, projectId: "project", projectRootPath: root, projectDisplayName: "Project", projectKind: "git",
    workspaceDirectory: id === "current" ? root : join(root, id), workspaceKind: "worktree", name: id,
    archivingAt: null, status: "done", statusEnteredAt: null, activityAt: null, scripts: [],
  });
  const workspaces = new Map([["current", workspace("current")]]);
  const agents = new Map<string, Agent>();
  const receipts = new Map<string, string>();
  const prompts: string[] = [];
  const creations: Create[] = [];
  const agentCreations: CreateAgent[] = [];
  const state: { failure: "none" | "workspace_rejected" | "workspace_unknown" | "agent_rejected" | "lost_response" | "lost_prompt"; projectKind: "git" | "directory"; promptStarted: boolean } = {
    failure: "none", projectKind: "git", promptStarted: true,
  };
  function admit(key: string | undefined, options: Create | CreateAgent) {
    if (!key) throw new Error("missing key");
    const serialized = JSON.stringify(options);
    const previous = receipts.get(key);
    if (previous && previous !== serialized) throw new Error("workspace_request_key_conflict");
    receipts.set(key, serialized);
  }
  function createAgent(workspaceId: string, options: CreateAgent) {
    if (!options.agentId) throw new Error("missing caller ID");
    if (!agents.has(options.agentId)) {
      agents.set(options.agentId, { agent: { id: options.agentId, workspaceId, labels: options.labels ?? {} } });
      if (state.promptStarted && state.failure !== "lost_prompt") prompts.push(options.prompt ?? "");
    }
    return options.agentId;
  }
  const paseo: LaunchPaseo = {
    hosts: { list: async () => ({ self: { serverId: "host", label: "Host" }, hosts: [] }) },
    projects: { list: async () => ({ requestId: "test", projects: [{
      projectId: "project", projectRootPath: root, projectDisplayName: "Project", projectKind: state.projectKind,
    }] }) },
    providers: {
      listAvailable: vi.fn(async () => ({ requestId: "test", fetchedAt: "now", providers: [{ provider: "discovered", available: true }] })),
      snapshot: vi.fn<LaunchPaseo["providers"]["snapshot"]>(async () => ({ requestId: "test", generatedAt: "now", entries: [{
        provider: "discovered", status: "ready", enabled: true, label: "Discovered", defaultModeId: "normal",
      }] })),
      listModels: vi.fn(async () => ({ requestId: "test", fetchedAt: "now", provider: "discovered", models: [
        { provider: "discovered", id: "model/from/catalog", label: "Catalog model" },
        { provider: "discovered", id: "hidden", label: "Hidden", isSelectable: false },
      ] })),
      listModes: vi.fn(async () => ({ requestId: "test", fetchedAt: "now", provider: "discovered", modes: [{ id: "normal", label: "Normal" }] })),
    },
    workspaces: {
      ref: (id) => ({
        refresh: async () => workspaces.get(id) ?? null,
        agents: { create: async (options) => {
          agentCreations.push(options);
          admit(options.idempotencyKey, options);
          const agentId = createAgent(id, options);
          if (state.promptStarted) options.onEvent?.({ kind: "agent", idempotencyKey: options.idempotencyKey ?? "", revision: 1, phase: "prompt_started", workspaceId: id, agentId, error: null });
          options.onEvent?.({ kind: "agent", idempotencyKey: options.idempotencyKey ?? "", revision: 2, phase: "completed", workspaceId: id, agentId, error: null });
        } },
      }),
      create: async (options) => {
        creations.push(options);
        admit(options.idempotencyKey, options);
        const { workspaceId, agent } = options;
        if (!workspaceId || !agent) throw new Error("missing explicit IDs and combined agent");
        WorkspaceCreateRequestSchema.shape.workspaceId.parse(workspaceId);
        const event = { kind: "workspace", idempotencyKey: options.idempotencyKey ?? "", revision: 1, workspaceId, agentId: agent.agentId ?? null } satisfies Partial<Parameters<NonNullable<Create["onEvent"]>>[0]>;
        if (state.failure === "workspace_rejected") {
          options.onEvent?.({ ...event, phase: "failed", failedStage: "workspace", outcomeUnknown: false, error: "private detail" });
          throw new Error("private detail");
        }
        if (!workspaces.has(workspaceId)) workspaces.set(workspaceId, workspace(workspaceId));
        if (state.failure === "workspace_unknown") throw new Error("connection lost");
        options.onEvent?.({ ...event, phase: "workspace_ready", error: null });
        if (state.failure === "agent_rejected") {
          options.onEvent?.({ ...event, phase: "failed", failedStage: "agent", outcomeUnknown: false, error: "provider startup failed" });
          throw new Error("provider startup failed");
        }
        createAgent(workspaceId, agent);
        if (state.failure === "lost_response" || state.failure === "lost_prompt") throw new Error("connection lost");
        if (state.promptStarted) options.onEvent?.({ ...event, revision: 2, phase: "prompt_started", error: null });
        options.onEvent?.({ ...event, revision: 3, phase: "completed", error: null });
      },
    },
    agents: { ref: (id) => ({ refresh: async () => agents.get(id) ?? null }) },
  };
  return { paseo, state, workspaces, agents, prompts, creations, agentCreations };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kanban-launch-'"));
  cli("init", "--name=Launch tests");
  cli("create", "--title=Launch safely", `--body=${body}`);
  fixture = sdk();
  const ticket = ticketDetailSchema.parse(await readTicket({ workspaceId: "current", ticketId: 1 }, fixture));
  input = {
    workspaceId: "current", hostId: "host", projectId: ticket.projectId, boardId: ticket.boardId,
    ticketId: 1, revision: ticket.revision, launchId: randomUUID(), workspace: "worktree",
    provider: "discovered", model: "model/from/catalog", modeId: null, instructions: "Keep the existing design.",
  };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function options() {
  const { launchId: _launchId, workspace: _workspace, provider: _provider, model: _model, modeId: _modeId, instructions: _instructions, ...scope } = input;
  return launchOptions.output.parse(await getLaunchOptions(scope, fixture));
}
async function launch(value = input) { return launchResultSchema.parse(await startLaunch(value, fixture)); }

describe("launch preflight and supported SDK placement", () => {
  it("discovers models/modes and defaults Git projects to managed worktrees", async () => {
    expect(await options()).toMatchObject({ kind: "launch_options", defaultWorkspace: "worktree", workspaces: ["worktree", "current"], providers: [{
      id: "discovered", models: [{ id: "model/from/catalog" }], modes: [{ id: "normal" }], defaultModeId: "normal",
    }] });
    expect(await launch()).toMatchObject({ kind: "launched", promptDelivery: "confirmed", agentId: input.launchId });
    expect(fixture.creations).toHaveLength(1);
    expect(fixture.creations[0]).toMatchObject({ workspaceId: `wks_${createHash("sha256").update(input.launchId).digest("hex").slice(0, 16)}`, source: { kind: "worktree", cwd: root, projectId: "project", action: "branch-off" } });
    const agent = fixture.creations[0]?.agent;
    expect(agent?.config).toEqual({ provider: "discovered/model/from/catalog" });
    expect(agent?.labels).toMatchObject({ "kanban.host": "host", "kanban.board": input.boardId, "kanban.ticket": "1", "kanban.workspace": `wks_${createHash("sha256").update(input.launchId).digest("hex").slice(0, 16)}` });
    expect(JSON.stringify(agent?.labels)).not.toContain(body);
    expect(agent?.prompt).toContain(body);
    expect(agent?.prompt).toContain("show 1");
    expect(agent?.prompt).toContain("edit 1 --claim <your-name>");
    expect(agent?.prompt).toContain("list --unblocked");
    expect(agent?.prompt).toContain("never initialize or use a worktree-local board");
    expect(agent?.prompt).toContain("Stop on an existing claim");
    expect(agent?.prompt).toContain("Do not automatically merge, mark Done, archive resources");
    expect(agent?.prompt).toContain(input.instructions);
    expect(cli("show", "1", "--json")).not.toContain("claimed_by");
  });

  it("defaults directory projects to their root and supports the current workspace explicitly", async () => {
    fixture.state.projectKind = "directory";
    expect(await options()).toMatchObject({ defaultWorkspace: "directory", workspaces: ["directory", "current"] });
    expect(await launch({ ...input, workspace: "directory" })).toMatchObject({ kind: "launched" });
    expect(fixture.creations[0]?.source).toEqual({ kind: "directory", path: root, projectId: "project" });
    expect(await launch({ ...input, launchId: randomUUID(), workspace: "current", modeId: "normal" })).toMatchObject({ kind: "launched", workspaceId: "current" });
    expect(fixture.creations).toHaveLength(1);
    expect(fixture.agentCreations[0]?.config).toEqual({ provider: "discovered/model/from/catalog", modeId: "normal" });
  });

  it.each(["hostId", "projectId", "boardId"] as const)("rejects changed %s before resource creation", async (field) => {
    expect(await launch({ ...input, [field]: "different" })).toMatchObject({ kind: "launch_error", code: "scope_changed" });
    expect(fixture.creations).toHaveLength(0);
  });

  it("rejects a workspace attached to another project", async () => {
    const current = fixture.workspaces.get("current");
    if (!current) throw new Error("missing test workspace");
    current.projectId = "another";
    expect(await launch()).toMatchObject({ kind: "error", code: "workspace_unavailable" });
    expect(fixture.creations).toHaveLength(0);
  });

  it.each(["--claim=someone", "--block=waiting", "--title=changed"])("re-reads changed tickets before launch: %s", async (change) => {
    cli("edit", "1", change);
    expect(await launch()).toMatchObject({ kind: "error", code: "conflict" });
    const ticket = ticketDetailSchema.parse(await readTicket({ workspaceId: "current", ticketId: 1 }, fixture));
    if (!change.startsWith("--title")) {
      expect(await launch({ ...input, revision: ticket.revision })).toMatchObject({ kind: "launch_error", code: change.startsWith("--claim") ? "ticket_claimed" : "ticket_blocked" });
    }
    expect(fixture.creations).toHaveLength(0);
  });

  it.each([{ model: "gone" }, { provider: "gone" }, { modeId: "full-access" }, { workspace: "directory" }] satisfies Partial<LaunchInput>[])("rejects unavailable choices %j", async (change) => {
    expect(await launch({ ...input, ...change })).toMatchObject({ kind: "launch_error", code: "capability_unavailable" });
    expect(fixture.creations).toHaveLength(0);
  });

  it("rechecks the ticket after slow provider discovery", async () => {
    const original = fixture.paseo.providers.listModels;
    fixture.paseo.providers.listModels = async (...args) => {
      cli("edit", "1", "--title=Changed during discovery");
      return original(...args);
    };
    expect(await launch()).toMatchObject({ kind: "error", code: "conflict" });
    expect(fixture.creations).toHaveLength(0);
  });

  it("rechecks workspace placement after provider discovery", async () => {
    const original = fixture.paseo.providers.listModes;
    fixture.paseo.providers.listModes = async (...args) => {
      const current = fixture.workspaces.get("current");
      if (!current) throw new Error("missing test workspace");
      fixture.workspaces.set("current", { ...current, workspaceDirectory: "/changed" });
      return original(...args);
    };
    expect(await launch()).toMatchObject({ kind: "launch_error", code: "scope_changed" });
    expect(fixture.creations).toHaveLength(0);
  });

  it("rejects failed model discovery and disabled providers", async () => {
    fixture.paseo.providers.listModels = async () => ({ requestId: "test", provider: "discovered", fetchedAt: "now", error: "unavailable" });
    expect(await launch()).toMatchObject({ kind: "launch_error", code: "capability_unavailable" });
    fixture.paseo.providers.listAvailable = async () => ({ requestId: "test", fetchedAt: "now", providers: [{ provider: "discovered", available: false }] });
    expect(await launch()).toMatchObject({ kind: "launch_error", code: "capability_unavailable" });
    expect(fixture.creations).toHaveLength(0);
  });

  it("never initializes an inaccessible canonical board", async () => {
    await rm(join(root, "kanban"), { recursive: true });
    expect(await launch()).toMatchObject({ kind: "error", code: "board_missing" });
    expect(fixture.creations).toHaveLength(0);
  });
});

describe("launch identity and recovery", () => {
  it.each([
    { workspace: "worktree", promptStarted: false },
    { workspace: "current", promptStarted: false },
    { workspace: "worktree", promptStarted: true },
    { workspace: "current", promptStarted: true },
  ] satisfies { workspace: LaunchInput["workspace"]; promptStarted: boolean }[])("requires prompt_started before confirming completed creation: %j", async ({ workspace, promptStarted }) => {
    fixture.state.promptStarted = promptStarted;
    const request = { ...input, workspace };
    expect(await launch(request)).toMatchObject(promptStarted
      ? { kind: "launched", promptDelivery: "confirmed" }
      : { kind: "recovered", promptDelivery: "unknown" });
    expect(await launch(request)).toMatchObject({ kind: "recovered", promptDelivery: "unknown" });
    expect(fixture.creations.length + fixture.agentCreations.length).toBe(1);
    expect(fixture.prompts).toHaveLength(promptStarted ? 1 : 0);
  });

  it("suppresses concurrent duplicate launches and never resends the prompt", async () => {
    const results = await Promise.all([launch(), launch()]);
    expect(results.map(({ kind }) => kind).toSorted()).toEqual(["launched", "recovered"]);
    expect(fixture.creations).toHaveLength(1);
    expect(fixture.prompts).toHaveLength(1);
  });

  it.each(["lost_response", "lost_prompt"] as const)("recovers %s across plugin restart without any mutation", async (failure) => {
    fixture.state.failure = failure;
    expect(await launch()).toMatchObject({ kind: "recovered", promptDelivery: "unknown" });
    cli("edit", "1", "--claim=implementation-agent");
    vi.resetModules();
    const restarted = await import("../server/launch");
    expect(await restarted.recoverLaunch(input, fixture)).toMatchObject({ kind: "recovered", agentId: input.launchId, promptDelivery: "unknown" });
    expect(await restarted.startLaunch(input, fixture)).toMatchObject({ kind: "recovered" });
    expect(fixture.creations).toHaveLength(1);
    expect(fixture.prompts).toHaveLength(failure === "lost_prompt" ? 0 : 1);
  });

  it("reports definite workspace rejection separately from uncertain creation", async () => {
    fixture.state.failure = "workspace_rejected";
    expect(await launch()).toMatchObject({ kind: "launch_failed", outcome: "rejected", stage: "workspace", workspaceId: null });
    fixture.state.failure = "workspace_unknown";
    expect(await launch()).toMatchObject({ kind: "launch_failed", outcome: "unknown", workspaceId: `wks_${createHash("sha256").update(input.launchId).digest("hex").slice(0, 16)}` });
    const before = fixture.creations.length;
    expect(await recoverLaunch(input, fixture)).toMatchObject({ kind: "launch_failed", outcome: "unknown", workspaceId: `wks_${createHash("sha256").update(input.launchId).digest("hex").slice(0, 16)}` });
    expect(fixture.creations).toHaveLength(before);
  });

  it("reuses the exact request and existing workspace after definite agent startup failure", async () => {
    fixture.state.failure = "agent_rejected";
    expect(await launch()).toMatchObject({ kind: "launch_failed", outcome: "rejected", stage: "agent", workspaceId: `wks_${createHash("sha256").update(input.launchId).digest("hex").slice(0, 16)}` });
    fixture.state.failure = "none";
    expect(await launch()).toMatchObject({ kind: "launched" });
    expect(JSON.stringify(fixture.creations[0])).toBe(JSON.stringify(fixture.creations[1]));
    expect(fixture.workspaces.size).toBe(2);
    expect(fixture.agents.size).toBe(1);
    expect(fixture.prompts).toHaveLength(1);
  });

  it("does not attach a changed input to a session or partial workspace", async () => {
    fixture.state.failure = "agent_rejected";
    await launch();
    fixture.state.failure = "none";
    expect(await launch({ ...input, instructions: "Different" })).toMatchObject({ kind: "launch_error", code: "identity_conflict" });
    await launch();
    for (const changes of [{ instructions: "Different" }, { model: "another" }, { workspace: "current" }, { revision: "changed" }] satisfies Partial<LaunchInput>[]) {
      expect(await recoverLaunch({ ...input, ...changes }, fixture)).toMatchObject({ kind: "launch_error", code: "identity_conflict" });
    }
    expect(fixture.prompts).toHaveLength(1);
  });

  it("rejects mismatched durable metadata and agent placement", async () => {
    await launch();
    const agent = fixture.agents.get(input.launchId);
    if (!agent) throw new Error("missing test agent");
    agent.agent.labels[launchLabelKeys.hostId] = "other-host";
    expect(await recoverLaunch(input, fixture)).toMatchObject({ kind: "launch_error", code: "identity_conflict" });
    agent.agent.labels[launchLabelKeys.hostId] = "host";
    agent.agent.workspaceId = "other-workspace";
    expect(await recoverLaunch(input, fixture)).toMatchObject({ kind: "launch_error", code: "identity_conflict" });
  });

  it("treats absent resources as unknown and rejects unsupported launch fields", async () => {
    expect(await recoverLaunch(input, fixture)).toMatchObject({ kind: "launch_failed", outcome: "unknown", workspaceId: null });
    expect(fixture.creations).toHaveLength(0);
    for (const extra of [{ command: "arbitrary" }, { cwd: "/wrong" }, { permissionMode: "bypass" }, { labels: {} }]) {
      expect(launchInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });
});
