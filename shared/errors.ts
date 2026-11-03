import { z } from "zod";

export const boardErrorMessages = {
  invalid_input: "Invalid kanban operation.",
  workspace_unavailable: "The workspace or its project is unavailable.",
  root_unavailable: "The project root is unavailable.",
  board_unavailable: "The board directory is unavailable.",
  board_missing: "The project has no kanban board.",
  invalid_configuration: "The board configuration is missing or invalid.",
  executable_missing: "kanban-md is not installed on the daemon PATH.",
  process_failed: "kanban-md could not run.",
  cli_rejected: "kanban-md rejected the operation.",
  invalid_output: "kanban-md returned an invalid response.",
  timeout: "kanban-md exceeded the execution time limit.",
  output_limit: "kanban-md exceeded the output limit.",
  write_uncertain: "The write outcome is unknown. Refresh before another write; do not retry automatically.",
  conflict: "This ticket changed. Keep your draft and reload the saved ticket before trying again.",
};

export const boardErrorSchema = z.strictObject({
  kind: z.literal("error"),
  code: z.enum(["invalid_input", "workspace_unavailable", "root_unavailable", "board_unavailable", "board_missing", "invalid_configuration", "executable_missing", "process_failed", "cli_rejected", "invalid_output", "timeout", "output_limit", "write_uncertain", "conflict"]),
  message: z.string(),
  cliCode: z.string().nullable(),
});
