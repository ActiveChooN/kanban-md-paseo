import type { RpcInput } from "@getpaseo/plugin";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { boardReadResultSchema, boardSnapshotSchema } from "../shared/board";
import { boardRead, ticketRead } from "../shared/rpc";
import { ticketDetailSchema, ticketIdSchema } from "../shared/ticket";
import type { BoardLookup, ResolvedBoard } from "./board";
import { runKanban } from "./cli";
import { BoardError, failure } from "./errors";
import { withBoard } from "./queue";

const name = z.string().min(1);
const timestamp = z.iso.datetime({ offset: true });
export const cliTicket = z.looseObject({
  id: ticketIdSchema, title: name, status: name, priority: name,
  created: timestamp, updated: timestamp,
  assignee: name.optional(), tags: z.array(name).optional(), due: z.iso.date().optional(),
  blocked: z.boolean().optional(), block_reason: z.string().optional(),
  depends_on: z.array(ticketIdSchema).optional(),
  claimed_by: name.optional(), claimed_at: timestamp.optional(), body: z.string().optional(),
}).refine((task) => Boolean(task.claimed_by) === Boolean(task.claimed_at));

const cliConfig = z.object({
  "board.name": name, tasks_dir: name,
  statuses: z.array(name).min(1), priorities: z.array(name).min(1),
  "defaults.status": name, "defaults.priority": name,
  wip_limits: z.record(z.string(), z.number().int().nonnegative()),
}).refine((config) => config.statuses.includes(config["defaults.status"])
  && config.priorities.includes(config["defaults.priority"]));
const claimConfig = z.object({
  statuses: z.array(z.union([
    name.transform((name) => ({ name, require_claim: false })),
    z.object({ name, require_claim: z.boolean().default(false) }),
  ])).min(1),
});

export function summary(task: z.infer<typeof cliTicket>) {
  return {
    id: task.id, title: task.title, status: task.status, priority: task.priority,
    assignee: task.assignee ?? null, tags: task.tags ?? [], due: task.due ?? null,
    blocked: task.blocked ?? false, blockReason: task.block_reason ?? null,
    dependsOn: task.depends_on ?? [],
    claim: task.claimed_by && task.claimed_at ? { name: task.claimed_by, claimedAt: task.claimed_at } : null,
  };
}

export async function readBoard(input: RpcInput<typeof boardRead>, { paseo }: { paseo: BoardLookup }) {
  try {
    const parsed = boardRead.input.safeParse(input);
    if (!parsed.success) throw new BoardError("invalid_input");
    return await withBoard({ paseo, ...parsed.data }, async ({ board, state }) => {
      const result = await readBoardAt(board);
      // A full successful refresh reconciles an uncertain write; never replay it.
      state.uncertain = false;
      return result;
    });
  } catch (error) { return failure(error); }
}

export async function readBoardAt(board: ResolvedBoard) {
  const identity = { boardId: board.boardId, projectId: board.projectId };
  if (board.kind === "missing") return { kind: "missing", ...identity } satisfies z.infer<typeof boardReadResultSchema>;
  const config = await runKanban({ board, operation: { kind: "config" }, output: cliConfig });
  // 0.39.x config JSON omits require_claim, so read only those flags from YAML.
  let claims: z.infer<typeof claimConfig>;
  try {
    claims = claimConfig.parse(parse(await readFile(join(board.directory, "config.yml"), "utf8")));
    if (JSON.stringify(claims.statuses.map(({ name }) => name)) !== JSON.stringify(config.statuses)) throw new Error();
  } catch { throw new BoardError("invalid_configuration"); }
  try {
    if (!(await stat(join(board.directory, config.tasks_dir))).isDirectory()) throw new Error();
  } catch { throw new BoardError("board_unavailable"); }
  const tickets = await runKanban({ board, operation: { kind: "list" }, output: z.array(cliTicket) });
  return boardSnapshotSchema.parse({
    kind: "ready", ...identity,
    config: {
      name: config["board.name"], priorities: config.priorities,
      defaults: { status: config["defaults.status"], priority: config["defaults.priority"] },
      statuses: claims.statuses.map((status) => ({
        name: status.name, requireClaim: status.require_claim,
        wipLimit: config.wip_limits[status.name] ?? null,
      })),
    },
    tickets: tickets.map(summary),
  });
}

// Sort object keys recursively; retain all CLI metadata, including unknown properties.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function readTicket(input: RpcInput<typeof ticketRead>, { paseo }: { paseo: BoardLookup }) {
  try {
    const parsed = ticketRead.input.safeParse(input);
    if (!parsed.success) throw new BoardError("invalid_input");
    return await withBoard({ paseo, workspaceId: parsed.data.workspaceId }, ({ board }) =>
      readTicketAt(board, parsed.data.ticketId));
  } catch (error) { return failure(error); }
}

export async function readTicketAt(board: ResolvedBoard, ticketId: number) {
  const task = await runKanban({ board, operation: { kind: "show", ticketId }, output: cliTicket });
  if (task.id !== ticketId) throw new BoardError("invalid_output");
  // shortcut: revisions cover CLI-visible content; use raw-file revisions if arbitrary YAML fields become editable.
  const { file: _file, children: _children, ...content } = task;
  return ticketDetailSchema.parse({
    ...summary(task), boardId: board.boardId, projectId: board.projectId,
    description: task.body ?? "",
    revision: createHash("sha256").update(canonical(content)).digest("hex"),
  });
}
