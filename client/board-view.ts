import { z } from "zod";
import type { TicketSummary } from "../shared/ticket";

export const boardViewSchema = z.object({
  scope: z.string(),
  search: z.string(),
  status: z.string(),
  priority: z.string(),
  assignee: z.string(),
  tag: z.string(),
  blocked: z.enum(["all", "blocked", "unblocked"]),
  selectedStatus: z.string(),
  selectedTicket: z.number().int().positive().nullable(),
});
export type BoardView = z.infer<typeof boardViewSchema>;
export const defaultBoardView: BoardView = {
  scope: "", search: "", status: "", priority: "", assignee: "", tag: "",
  blocked: "all", selectedStatus: "", selectedTicket: null,
};

export function boardQueryKey(hostId: string, boardId: string): string {
  return JSON.stringify(["board", hostId, boardId]);
}

export function filterTickets(tickets: TicketSummary[], view: BoardView): TicketSummary[] {
  const search = view.search.trim().toLocaleLowerCase();
  return tickets.filter((ticket) =>
    (!search || ticket.title.toLocaleLowerCase().includes(search) || String(ticket.id).includes(search.replace(/^#/, ""))) &&
    (!view.status || ticket.status === view.status) &&
    (!view.priority || ticket.priority === view.priority) &&
    (!view.assignee || (view.assignee === "unassigned" ? ticket.assignee === null : `name:${ticket.assignee}` === view.assignee)) &&
    (!view.tag || ticket.tags.includes(view.tag)) &&
    (view.blocked === "all" || ticket.blocked === (view.blocked === "blocked")),
  );
}
