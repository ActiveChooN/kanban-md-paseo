import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { boardErrorSchema } from "./errors";
import { revisionSchema, ticketInputSchema } from "./ticket";

const id = z.string().min(1);
export const launchScopeSchema = ticketInputSchema.extend({
  hostId: id,
  boardId: id,
  projectId: id,
  revision: revisionSchema,
});
const workspaceKind = z.enum(["worktree", "directory", "current"]);
const choice = z.strictObject({ id, label: z.string() });
export const launchInputSchema = launchScopeSchema.extend({
  // Retain this ID and the entire input across reconnects and retries.
  launchId: z.uuid(),
  workspace: workspaceKind,
  provider: id,
  model: id,
  // null preserves the provider's normal permissions; overrides require an explicit choice.
  modeId: id.nullable(),
  instructions: z.string(),
});
export type LaunchInput = z.infer<typeof launchInputSchema>;

export const launchErrorSchema = z.strictObject({
  kind: z.literal("launch_error"),
  code: z.enum(["scope_changed", "ticket_claimed", "ticket_blocked", "capability_unavailable", "identity_conflict"]),
  message: z.string(),
});
export const launchLinkSchema = z.strictObject({
  hostId: id, boardId: id, projectId: id, ticketId: z.number().int().positive(),
  launchId: z.uuid(), workspaceId: id, agentId: z.uuid(),
});
export type LaunchLink = z.infer<typeof launchLinkSchema>;
export const launchResultSchema = z.union([
  launchLinkSchema.extend({ kind: z.literal("launched"), promptDelivery: z.literal("confirmed") }),
  launchLinkSchema.extend({ kind: z.literal("recovered"), promptDelivery: z.literal("unknown") }),
  z.strictObject({
    kind: z.literal("launch_failed"), launchId: z.uuid(),
    outcome: z.enum(["rejected", "unknown"]), stage: z.enum(["workspace", "agent", "prompt"]),
    workspaceId: id.nullable(), agentId: id.nullable(), message: z.string(),
  }),
  launchErrorSchema,
  boardErrorSchema,
]);
export type LaunchResult = z.infer<typeof launchResultSchema>;

export const launchOptions = defineRpc({
  name: "launch.options",
  input: launchScopeSchema,
  output: z.union([
    z.strictObject({
      kind: z.literal("launch_options"), launchId: z.uuid(),
      defaultWorkspace: workspaceKind, workspaces: z.array(workspaceKind),
      instructions: z.string(),
      providers: z.array(z.strictObject({
        id, label: z.string(), models: z.array(choice), modes: z.array(choice),
        defaultModeId: id.nullable(),
      })),
    }),
    launchErrorSchema, boardErrorSchema,
  ]),
});
export const launchStart = defineRpc({ name: "launch.start", input: launchInputSchema, output: launchResultSchema });
// Read-only inspection. An absent resource never proves that creation was rejected.
export const launchRecover = defineRpc({ name: "launch.recover", input: launchInputSchema, output: launchResultSchema });

export const launchLabelKeys = {
  hostId: "kanban.host", boardId: "kanban.board", projectId: "kanban.project",
  ticketId: "kanban.ticket", launchId: "kanban.launch", workspaceId: "kanban.workspace",
  fingerprint: "kanban.input",
};
