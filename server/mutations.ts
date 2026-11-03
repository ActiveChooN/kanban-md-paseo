import type { RpcInput } from "@getpaseo/plugin";
import { z } from "zod";
import { boardCreate, ticketCreate, ticketMove, ticketUpdate } from "../shared/rpc";
import { ticketIdSchema, type TicketChanges, type TicketDetail } from "../shared/ticket";
import { resolveBoard, type BoardLookup, type ResolvedBoard } from "./board";
import { runKanban, type KanbanOperation } from "./cli";
import { BoardError, failure } from "./errors";
import { withBoard } from "./queue";
import { readBoardAt, readTicketAt } from "./reads";

type Context = { paseo: BoardLookup };
type Write = <T>(operation: KanbanOperation, output: z.ZodType<T>) => Promise<T>;

async function mutate<Input extends { workspaceId: string }, Result>(input: Input, schema: z.ZodType<Input>,
  { paseo }: Context, operation: (board: ResolvedBoard, input: Input, write: Write) => Promise<Result>) {
  try {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new BoardError("invalid_input");
    return await withBoard({ paseo, workspaceId: parsed.data.workspaceId }, async ({ board, state }) => {
      if (state.uncertain) throw new BoardError("write_uncertain");
      let written = false;
      try {
        return await operation(board, parsed.data, async (operation, output) => {
          const result = await runKanban({ board, operation, output });
          written = true;
          return result;
        });
      } catch (error) {
        if (written || (error instanceof BoardError && error.code === "write_uncertain")) {
          state.uncertain = true;
          throw new BoardError("write_uncertain");
        }
        throw error;
      }
    });
  } catch (error) { return failure(error); }
}

export function createBoard(input: RpcInput<typeof boardCreate>, context: Context) {
  return mutate(input, boardCreate.input, context, async (board, input, write) => {
    if (board.kind !== "missing") throw new BoardError("cli_rejected", undefined, "BOARD_ALREADY_EXISTS");
    await write({ kind: "init" }, z.object({ status: z.literal("initialized") }));
    const created = await resolveBoard({ ...context, workspaceId: input.workspaceId });
    if (created.boardId !== board.boardId) throw new BoardError("board_unavailable");
    const result = await readBoardAt(created);
    if (result.kind !== "ready") throw new BoardError("board_missing");
    return result;
  });
}

export function createTicket(input: RpcInput<typeof ticketCreate>, context: Context) {
  return mutate(input, ticketCreate.input, context, async (board, { workspaceId: _workspaceId, ...fields }, write) => {
    const snapshot = await readBoardAt(board);
    if (snapshot.kind !== "ready") throw new BoardError("board_missing");
    // 0.39.0 create omits the claim-required check that edit and move perform.
    if (snapshot.config.statuses.some((status) => status.name === snapshot.config.defaults.status && status.requireClaim)) {
      throw new BoardError("cli_rejected", undefined, "CLAIM_REQUIRED");
    }
    const created = await write({ kind: "create", fields }, z.object({ id: ticketIdSchema }));
    return readTicketAt(board, created.id);
  });
}

function changedFields(current: TicketDetail, changes: TicketChanges) {
  const fields: Extract<KanbanOperation, { kind: "edit" }>["fields"] = {};
  for (const key of ["title", "description", "priority", "assignee", "due", "blockReason"] satisfies (keyof TicketChanges)[]) {
    const value = changes[key];
    if (value !== undefined && value !== current[key]) Object.assign(fields, { [key]: value });
  }
  // Unblock also clears legacy blocked tasks that have no reason.
  if (changes.blockReason === null && current.blocked) fields.blockReason = null;
  if (changes.tags !== undefined) {
    const tags = new Set(changes.tags);
    const addTags = [...tags].filter((tag) => !current.tags.includes(tag));
    const removeTags = current.tags.filter((tag) => !tags.has(tag));
    if (addTags.length) fields.addTags = addTags;
    if (removeTags.length) fields.removeTags = removeTags;
  }
  return fields;
}

export function updateTicket(input: RpcInput<typeof ticketUpdate>, context: Context) {
  return mutate(input, ticketUpdate.input, context, async (board, input, write) => {
    const current = await readTicketAt(board, input.ticketId);
    if (current.revision !== input.revision) throw new BoardError("conflict");
    const fields = changedFields(current, input.changes);
    if (!Object.keys(fields).length) return current;
    await write({ kind: "edit", ticketId: input.ticketId, fields }, z.object({ id: z.literal(input.ticketId) }));
    return readTicketAt(board, input.ticketId);
  });
}

export function moveTicket(input: RpcInput<typeof ticketMove>, context: Context) {
  return mutate(input, ticketMove.input, context, async (board, input, write) => {
    const current = await readTicketAt(board, input.ticketId);
    if (current.revision !== input.revision) throw new BoardError("conflict");
    if (current.status === input.status) return current;
    await write({ kind: "move", ticketId: input.ticketId, status: input.status }, z.object({ id: z.literal(input.ticketId) }));
    return readTicketAt(board, input.ticketId);
  });
}
