import type { BoardConfig } from "../shared/board";
import type { TicketDetail } from "../shared/ticket";
export const config: BoardConfig = { name: "Test", defaults: { status: "todo", priority: "urgent" },
  statuses: [{ name: "todo", wipLimit: null, requireClaim: false }, { name: "doing", wipLimit: 2, requireClaim: true }], priorities: ["low", "urgent"] };
export const ticket: TicketDetail = { id: 1, boardId: "/board", projectId: "p", title: "Original", description: "# Original",
  revision: "original-hash", status: "todo", priority: "low", assignee: "Ada", tags: ["one"], due: null, blocked: false,
  blockReason: null, dependsOn: [2], claim: { name: "owl", claimedAt: "2026-11-01T12:00:00Z" } };
