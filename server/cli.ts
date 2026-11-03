import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { ticketChangesSchema, ticketCreateInputSchema, ticketIdSchema } from "../shared/ticket";
import type { ResolvedBoard } from "./board";
import { BoardError, type BoardErrorCode } from "./errors";

const editFields = z.strictObject(ticketChangesSchema.shape).omit({ tags: true }).extend({
  addTags: z.array(z.string().min(1)).optional(),
  removeTags: z.array(z.string().min(1)).optional(),
});
const operationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("config") }),
  z.strictObject({ kind: z.literal("list") }),
  z.strictObject({ kind: z.literal("init") }),
  z.strictObject({ kind: z.literal("show"), ticketId: ticketIdSchema }),
  z.strictObject({ kind: z.literal("create"), fields: ticketCreateInputSchema.omit({ workspaceId: true }) }),
  z.strictObject({ kind: z.literal("edit"), ticketId: ticketIdSchema, fields: editFields }),
  z.strictObject({ kind: z.literal("move"), ticketId: ticketIdSchema, status: z.string().min(1) }),
]);
export type KanbanOperation = z.infer<typeof operationSchema>;

// pflag's string-slice flags parse CSV, including quotes and commas inside a tag.
function csv(values: string[]) {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
}

function argumentsFor(operation: KanbanOperation, board: ResolvedBoard): string[] {
  switch (operation.kind) {
    case "config": case "list": return [operation.kind];
    case "init": return ["init", `--name=${board.projectName}`];
    case "show": return ["show", String(operation.ticketId)];
    case "move": return ["move", "--", String(operation.ticketId), operation.status];
    case "create": case "edit": {
      const fields = operation.fields;
      const args = operation.kind === "create" ? ["create"] : ["edit", String(operation.ticketId)];
      if (fields.title !== undefined) args.push(`--title=${fields.title}`);
      if (fields.description !== undefined) args.push(`--body=${fields.description}`);
      if (fields.priority !== undefined) args.push(`--priority=${fields.priority}`);
      if (fields.assignee !== undefined) args.push(`--assignee=${fields.assignee}`);
      if (fields.due === null) args.push("--clear-due");
      else if (fields.due !== undefined) args.push(`--due=${fields.due}`);
      if ("tags" in fields && fields.tags !== undefined) args.push(`--tags=${csv(fields.tags)}`);
      if ("addTags" in fields && fields.addTags?.length) args.push(`--add-tag=${csv(fields.addTags)}`);
      if ("removeTags" in fields && fields.removeTags?.length) args.push(`--remove-tag=${csv(fields.removeTags)}`);
      if ("blockReason" in fields) {
        if (fields.blockReason === null) args.push("--unblock");
        else if (fields.blockReason !== undefined) args.push(`--block=${fields.blockReason}`);
      }
      return args;
    }
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

const rejectionSchema = z.object({
  code: z.enum([
    "INVALID_PRIORITY", "INVALID_STATUS", "TASK_NOT_FOUND", "CLAIM_REQUIRED", "TASK_CLAIMED",
    "WIP_LIMIT_EXCEEDED", "INVALID_INPUT", "INVALID_DATE", "INVALID_TASK_ID", "NO_CHANGES",
    "BOARD_ALREADY_EXISTS", "DEPENDENCY_NOT_FOUND", "SELF_REFERENCE", "BOUNDARY_ERROR", "STATUS_CONFLICT",
  ]),
});

/** Server-only boundary. Pass a resolver result and a schema for this command's CLI JSON. */
export async function runKanban<T>({ board, operation, output }: {
  board: ResolvedBoard;
  operation: KanbanOperation;
  output: z.ZodType<T>;
}): Promise<T> {
  const parsed = operationSchema.safeParse(operation);
  if (!parsed.success) throw new BoardError("invalid_input");
  operation = parsed.data;
  const write = operation.kind === "init" || operation.kind === "create" || operation.kind === "edit" || operation.kind === "move";
  if (operation.kind !== "init" && board.kind === "missing") throw new BoardError("board_missing");
  if (operation.kind === "init" && board.kind !== "missing") throw new BoardError("cli_rejected");
  const args = ["--dir", board.directory, "--json", ...argumentsFor(operation, board)];
  if (args.some((arg) => arg.includes("\0"))) throw new BoardError("invalid_input");
  try {
    if (!(await stat(board.projectRootPath)).isDirectory()) throw new Error();
  } catch {
    throw new BoardError("root_unavailable");
  }

  return new Promise((resolve, reject) => {
    let started = false;
    const fail = (code: BoardErrorCode, uncertain = write && started) => {
      reject(new BoardError(uncertain ? "write_uncertain" : code, uncertain ? code : undefined));
    };
    try {
      const child = execFile("kanban-md", args, {
        cwd: board.projectRootPath,
        shell: false,
        encoding: "utf8",
        timeout: 10_000,
        killSignal: "SIGKILL",
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error?.code === "ENOENT") {
          // ENOENT also means cwd vanished between preflight and spawn.
          void stat(board.projectRootPath).then(
            () => fail("executable_missing", false),
            () => fail("root_unavailable", false),
          );
          return;
        }
        if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return fail("output_limit");
        if (error?.killed) return fail("timeout");
        if (error && typeof error.code !== "number") return fail("process_failed");
        let value: unknown;
        try {
          value = JSON.parse(stdout);
        } catch {
          return fail("invalid_output");
        }
        if (error) {
          const configError = z.object({ code: z.literal("INTERNAL_ERROR"), error: z.string() }).safeParse(value);
          if (configError.success && /^(parsing config:|invalid config:)/.test(configError.data.error)) {
            return fail("invalid_configuration", false);
          }
          if (configError.success && configError.data.error === "no kanban board found (run 'kanban-md init' to create one)") {
            return fail("board_missing", false);
          }
          const rejection = rejectionSchema.safeParse(value);
          if (rejection.success) return reject(new BoardError("cli_rejected", undefined, rejection.data.code));
          return fail("cli_rejected");
        }
        // The CLI exits successfully after skipping malformed or unreadable tasks.
        if (!write && stderr.trim()) return fail("invalid_output");
        const result = output.safeParse(value);
        if (!result.success) return fail("invalid_output");
        resolve(result.data);
      });
      child.once("spawn", () => { started = true; });
      child.stdin?.on("error", () => {});
      child.stdin?.end();
    } catch {
      fail("process_failed", false);
    }
  });
}
