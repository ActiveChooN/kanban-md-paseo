import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  launchInputSchema, launchLabelKeys, launchOptions, launchScopeSchema,
  type LaunchInput, type LaunchLink, type LaunchResult,
} from "../shared/launch";
import type { TicketDetail } from "../shared/ticket";
import { resolveBoard, type BoardLookup, type ResolvedBoard } from "./board";
import { BoardError, failure } from "./errors";
import { withBoard } from "./queue";
import { readTicketAt } from "./reads";

type Paseo = PluginHandlerContext["paseo"];
type Workspace = ReturnType<Paseo["workspaces"]["ref"]>;
type Agent = NonNullable<Awaited<ReturnType<ReturnType<Paseo["agents"]["ref"]>["refresh"]>>>;
export type LaunchPaseo = Omit<BoardLookup, "workspaces"> & {
  hosts: Pick<Paseo["hosts"], "list">;
  providers: Pick<Paseo["providers"], "listAvailable" | "listModels" | "listModes" | "snapshot">;
  workspaces: {
    ref(id: string): Pick<Workspace, "refresh"> & {
      agents: { create(options: Parameters<Workspace["agents"]["create"]>[0]): Promise<unknown> };
    };
    create(options: Parameters<Paseo["workspaces"]["create"]>[0]): Promise<unknown>;
  };
  agents: { ref(id: string): { refresh(): Promise<{ agent: Pick<Agent["agent"], "id" | "workspaceId" | "labels"> } | null> } };
};
type Context = { paseo: LaunchPaseo };
type Scope = RpcInput<typeof launchOptions>;
type Creation = Parameters<NonNullable<Parameters<Paseo["workspaces"]["create"]>[0]["onEvent"]>>[0];

const messages = {
  scope_changed: "The host, board, project, or workspace changed. Reopen the launch dialog.",
  ticket_claimed: "This ticket already has a claim. Resolve ownership through kanban-md before launching.",
  ticket_blocked: "This ticket is blocked. Resolve the block before launching.",
  capability_unavailable: "The selected provider, model, permission mode, or workspace option is unavailable. Refresh launch options.",
  identity_conflict: "This launch identity belongs to a different request or resource. Preserve the original launch input and inspect it.",
};
class LaunchError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); }
}
function launchFailure(error: unknown) {
  return error instanceof LaunchError
    ? { kind: "launch_error", code: error.code, message: error.message } satisfies LaunchResult
    : failure(error);
}

async function validateScope(paseo: LaunchPaseo, input: Scope, board: ResolvedBoard) {
  const { self } = await paseo.hosts.list();
  if (self.serverId !== input.hostId || board.boardId !== input.boardId || board.projectId !== input.projectId) {
    throw new LaunchError("scope_changed");
  }
  if (board.kind === "missing") throw new BoardError("board_missing");
  const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
  if (!workspace || workspace.id !== input.workspaceId || workspace.projectId !== input.projectId || workspace.archivingAt) {
    throw new LaunchError("scope_changed");
  }
  if (await realpath(workspace.projectRootPath) !== board.projectRootPath) throw new LaunchError("scope_changed");
  return workspace;
}

async function savedTicket(board: ResolvedBoard, input: Scope) {
  const ticket = await readTicketAt(board, input.ticketId);
  if (ticket.revision !== input.revision) throw new BoardError("conflict");
  if (ticket.claim) throw new LaunchError("ticket_claimed");
  if (ticket.blocked) throw new LaunchError("ticket_blocked");
  return ticket;
}

async function capabilities(paseo: LaunchPaseo, cwd: string) {
  const [available, catalog] = await Promise.all([
    paseo.providers.listAvailable(), paseo.providers.snapshot({ cwd }),
  ]);
  if (available.error) throw new LaunchError("capability_unavailable");
  return Promise.all(available.providers.filter((provider) => provider.available && !provider.error
    && catalog.entries.find((entry) => entry.provider === provider.provider)?.enabled !== false).map(async ({ provider }) => {
    const [models, modes] = await Promise.all([
      paseo.providers.listModels(provider, { cwd }), paseo.providers.listModes(provider, { cwd }),
    ]);
    const entry = catalog.entries.find((entry) => entry.provider === provider);
    return {
      id: provider, label: entry?.label ?? provider,
      models: models.error || modes.error ? [] : (models.models ?? []).filter((model) => model.isSelectable !== false).map(({ id, label }) => ({ id, label })),
      modes: modes.error ? [] : (modes.modes ?? []).map(({ id, label }) => ({ id, label })),
      defaultModeId: entry?.defaultModeId ?? null,
    };
  }));
}

export async function getLaunchOptions(input: Scope, { paseo }: Context) {
  try {
    const parsed = launchScopeSchema.safeParse(input);
    if (!parsed.success) throw new BoardError("invalid_input");
    return await withBoard({ paseo, workspaceId: input.workspaceId }, async ({ board }) => {
      const workspace = await validateScope(paseo, parsed.data, board);
      const ticket = await savedTicket(board, parsed.data);
      const defaultWorkspace = board.projectKind === "git" ? "worktree" : "directory";
      return {
        kind: "launch_options", launchId: randomUUID(), defaultWorkspace,
        workspaces: [defaultWorkspace, "current"],
        instructions: `Implement ticket #${ticket.id}: ${ticket.title}.\n\n${ticket.description}`,
        providers: await capabilities(paseo, workspace.workspaceDirectory),
      } satisfies RpcOutput<typeof launchOptions>;
    });
  } catch (error) { return launchFailure(error); }
}

function identity(input: LaunchInput) {
  // Paseo validates caller-supplied workspace IDs as wks_ plus 16 hexadecimal digits.
  const workspaceId = input.workspace === "current" ? input.workspaceId
    : `wks_${createHash("sha256").update(input.launchId).digest("hex").slice(0, 16)}`;
  const link = {
    hostId: input.hostId, boardId: input.boardId, projectId: input.projectId, ticketId: input.ticketId,
    launchId: input.launchId, workspaceId, agentId: input.launchId,
  } satisfies LaunchLink;
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return {
    link,
    key: `kanban:${input.hostId}:${input.launchId}`,
    labels: {
      [launchLabelKeys.hostId]: link.hostId, [launchLabelKeys.boardId]: link.boardId,
      [launchLabelKeys.projectId]: link.projectId, [launchLabelKeys.ticketId]: String(link.ticketId),
      [launchLabelKeys.launchId]: link.launchId, [launchLabelKeys.workspaceId]: link.workspaceId,
      [launchLabelKeys.fingerprint]: fingerprint,
    },
  };
}

async function inspect(paseo: LaunchPaseo, input: LaunchInput, board: ResolvedBoard) {
  const { link, labels } = identity(input);
  const [agent, workspace] = await Promise.all([
    paseo.agents.ref(link.agentId).refresh(), paseo.workspaces.ref(link.workspaceId).refresh(),
  ]);
  if (workspace && (workspace.id !== link.workspaceId || workspace.projectId !== input.projectId || workspace.archivingAt)) {
    throw new LaunchError("identity_conflict");
  }
  if (workspace && await realpath(workspace.projectRootPath) !== board.projectRootPath) throw new LaunchError("identity_conflict");
  if (agent) {
    if (!workspace || agent.agent.id !== link.agentId || agent.agent.workspaceId !== link.workspaceId
      || Object.entries(labels).some(([key, value]) => agent.agent.labels[key] !== value)) {
      throw new LaunchError("identity_conflict");
    }
    return { recovered: { kind: "recovered", ...link, promptDelivery: "unknown" } satisfies LaunchResult, workspace };
  }
  return { recovered: null, workspace };
}

function uncertain(input: LaunchInput, workspaceId: string | null, agentId: string | null): LaunchResult {
  return {
    kind: "launch_failed", launchId: input.launchId, outcome: "unknown", stage: agentId ? "prompt" : workspaceId ? "agent" : "workspace",
    workspaceId, agentId,
    message: "Launch outcome is unknown. Inspect existing resources or recover with the original launch input. Do not send the initial instructions again.",
  };
}

export async function recoverLaunch(input: LaunchInput, { paseo }: Context): Promise<LaunchResult> {
  try {
    const parsed = launchInputSchema.safeParse(input);
    if (!parsed.success) throw new BoardError("invalid_input");
    const board = await resolveBoard({ paseo, workspaceId: input.workspaceId });
    await validateScope(paseo, parsed.data, board);
    const found = await inspect(paseo, parsed.data, board);
    return found.recovered ?? uncertain(input, found.workspace?.id ?? null, null);
  } catch (error) { return launchFailure(error); }
}

function prompt(board: ResolvedBoard, ticket: TicketDetail, instructions: string) {
  const cli = `kanban-md --dir '${board.directory.replaceAll("'", "'\\''")}'`;
  return `Implement ticket #${ticket.id} from canonical board ${JSON.stringify(board.directory)}.
Before implementation, re-read the saved ticket with ${cli} show ${ticket.id}.
Use this canonical board for every kanban-md command, even inside a worktree. If it is inaccessible, stop and report it; never initialize or use a worktree-local board.
Respect repository and board instructions, blocking, dependencies, and existing claims. Check ${cli} list --unblocked and the ticket's blocked state. Stop if blocked or any dependency is unresolved.
Generate your own individual CLI claim name with ${cli} agent-name. Acquire ticket ${ticket.id} with ${cli} edit ${ticket.id} --claim <your-name> before changing implementation files. Re-read to verify ownership. Stop on an existing claim or ownership conflict; never take over or release another agent's claim.
Do not automatically merge, mark Done, archive resources, or launch follow-up agents.

Saved ticket #${ticket.id}: ${ticket.title}
Saved description and acceptance criteria:
${ticket.description}

User implementation instructions:
${instructions}`;
}

export async function startLaunch(input: LaunchInput, { paseo }: Context): Promise<LaunchResult> {
  try {
    const parsed = launchInputSchema.safeParse(input);
    if (!parsed.success) throw new BoardError("invalid_input");
    input = parsed.data;
    return await withBoard({ paseo, workspaceId: input.workspaceId }, async ({ board }) => {
      const current = await validateScope(paseo, input, board);
      const found = await inspect(paseo, input, board);
      if (found.recovered) return found.recovered;
      const expected = board.projectKind === "git" ? "worktree" : "directory";
      if (input.workspace !== "current" && input.workspace !== expected) throw new LaunchError("capability_unavailable");
      const providers = await capabilities(paseo, input.workspace === "current" ? current.workspaceDirectory : board.projectRootPath);
      const provider = providers.find(({ id }) => id === input.provider);
      if (!provider?.models.some(({ id }) => id === input.model)
        || (input.modeId !== null && !provider.modes.some(({ id }) => id === input.modeId))) {
        throw new LaunchError("capability_unavailable");
      }
      // Discovery may take time. Revalidate placement and saved content just before creation.
      const fresh = await resolveBoard({ paseo, workspaceId: input.workspaceId });
      const freshWorkspace = await validateScope(paseo, input, fresh);
      if (fresh.projectRootPath !== board.projectRootPath || fresh.projectKind !== board.projectKind
        || freshWorkspace.workspaceDirectory !== current.workspaceDirectory) throw new LaunchError("scope_changed");
      const ticket = await savedTicket(fresh, input);
      const { link, labels, key } = identity(input);
      const agent = {
        agentId: link.agentId, clientMessageId: key, labels,
        config: { provider: `${input.provider}/${input.model}`, ...(input.modeId === null ? {} : { modeId: input.modeId }) },
        title: `#${ticket.id}: ${ticket.title}`, prompt: prompt(fresh, ticket, input.instructions),
      };
      const progress: { snapshot: Creation | null; promptStarted: boolean } = { snapshot: null, promptStarted: false };
      const onEvent = (snapshot: Creation) => {
        progress.snapshot = snapshot;
        if (snapshot.phase === "prompt_started") progress.promptStarted = true;
      };
      try {
        if (input.workspace === "current") {
          await paseo.workspaces.ref(input.workspaceId).agents.create({ ...agent, idempotencyKey: key, onEvent });
        } else {
          await paseo.workspaces.create({
            workspaceId: link.workspaceId, idempotencyKey: key, onEvent,
            title: agent.title,
            source: input.workspace === "worktree"
              ? { kind: "worktree", cwd: fresh.projectRootPath, projectId: fresh.projectId, action: "branch-off", branchName: `kanban/${ticket.id}-${input.launchId}` }
              : { kind: "directory", path: fresh.projectRootPath, projectId: fresh.projectId },
            agent: { ...agent, cwd: fresh.projectRootPath },
          });
        }
        const recovered = await inspect(paseo, input, fresh);
        if (!recovered.recovered) return uncertain(input, recovered.workspace?.id ?? null, null);
        return progress.promptStarted && progress.snapshot?.phase === "completed"
          ? { kind: "launched", ...link, promptDelivery: "confirmed" }
          : recovered.recovered;
      } catch (error) {
        if (error instanceof LaunchError) throw error;
        if (error instanceof Error && /^(agent|workspace)_(request_key|id)_conflict$/.test(error.message)) {
          throw new LaunchError("identity_conflict");
        }
        const snapshot = progress.snapshot;
        const recovered = await inspect(paseo, input, fresh).catch(() => null);
        if (recovered?.recovered) return recovered.recovered;
        if (snapshot?.phase === "failed" && snapshot.outcomeUnknown === false) {
          return {
            kind: "launch_failed", launchId: input.launchId, outcome: "rejected", stage: snapshot.failedStage ?? "agent",
            workspaceId: recovered?.workspace?.id ?? null, agentId: null,
            message: "Creation was rejected. Preserve the original launch input; any retry must use that same identity.",
          };
        }
        return uncertain(input, recovered?.workspace?.id ?? null, null);
      }
    });
  } catch (error) { return launchFailure(error); }
}
