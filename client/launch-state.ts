import { z } from "zod";
import { launchInputSchema, launchResultSchema } from "../shared/launch";
import { boardViewSchema, defaultBoardView } from "./board-view";

export const launchAttemptSchema = z.object({
  input: launchInputSchema,
  result: launchResultSchema.nullable(),
  source: z.enum(["start", "retry", "recover"]).default("recover"),
});
export type LaunchAttempt = z.infer<typeof launchAttemptSchema>;

export function canReviseLaunch(attempt: LaunchAttempt) {
  const { result, source } = attempt;
  if (result?.kind === "launched") return true;
  if (source !== "start") return false;
  // Only first-start preflight failures prove no creation call was made.
  return (result?.kind === "launch_error" && ["scope_changed", "ticket_claimed", "ticket_blocked", "capability_unavailable"].includes(result.code))
    || (result?.kind === "error" && ["conflict", "invalid_input"].includes(result.code));
}

// One tab-state writer preserves both filters and launch recovery across remounts.
export const launchPanelSchema = boardViewSchema.extend({
  launches: z.array(launchAttemptSchema).default([]),
});
export const defaultLaunchPanel = { ...defaultBoardView, launches: [] };

export function launchForTicket(launches: LaunchAttempt[], scope: {
  hostId: string; boardId: string; projectId: string; workspaceId: string; ticketId: number;
}) {
  return launches.findLast(({ input }) => input.hostId === scope.hostId && input.boardId === scope.boardId
    && input.projectId === scope.projectId && input.workspaceId === scope.workspaceId && input.ticketId === scope.ticketId);
}
