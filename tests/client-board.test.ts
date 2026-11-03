import { describe, expect, it, vi } from "vitest";
import { boardQueryKey, boardViewSchema, defaultBoardView, filterTickets } from "../client/board-view";
import { getBoardQuery } from "../client/board-query";
import type { TicketSummary } from "../shared/ticket";
import type { BoardReadResult } from "../shared/board";

const base: TicketSummary = {
  id: 12, title: "Fix narrow board", status: "doing", priority: "urgent", assignee: "Ada",
  tags: ["ui", "v1"], blocked: true, blockReason: "Needs API", due: null, dependsOn: [], claim: null,
};
const tickets = [base, { ...base, id: 21, title: "Write docs", status: "todo", priority: "low", assignee: null, tags: [], blocked: false },
  { ...base, id: 3, title: "Keyboard access", assignee: "unassigned", tags: ["ui"] }];

describe("board filters and panel state", () => {
  it("searches titles case-insensitively and IDs with an optional #", () => {
    for (const search of [" NARROW ", "#12", "12"]) {
      expect(filterTickets(tickets, { ...defaultBoardView, search }).map((ticket) => ticket.id)).toEqual([12]);
    }
  });
  it("combines every filter and keeps blocking independent of status", () => {
    expect(filterTickets(tickets, { ...defaultBoardView, search: "board", status: "doing", priority: "urgent", assignee: "name:Ada", tag: "ui", blocked: "blocked" })).toEqual([base]);
    expect(filterTickets(tickets, { ...defaultBoardView, status: "doing", blocked: "unblocked" })).toEqual([]);
    expect(filterTickets(tickets, { ...defaultBoardView, blocked: "unblocked" }).map((ticket) => ticket.id)).toEqual([21]);
  });
  it("distinguishes an unassigned ticket from an assignee named unassigned", () => {
    expect(filterTickets(tickets, { ...defaultBoardView, assignee: "unassigned" }).map((ticket) => ticket.id)).toEqual([21]);
    expect(filterTickets(tickets, { ...defaultBoardView, assignee: "name:unassigned" }).map((ticket) => ticket.id)).toEqual([3]);
  });
  it("does not mutate ticket data and matches tags exactly", () => {
    const before = structuredClone(tickets);
    expect(filterTickets(tickets, { ...defaultBoardView, tag: "u" })).toEqual([]);
    expect(tickets).toEqual(before);
  });
  it("round trips view selection and rejects invalid restored state", () => {
    const state = { ...defaultBoardView, scope: boardQueryKey("host", "/canonical/kanban"), selectedTicket: 12, selectedStatus: "doing", tag: "ui" };
    expect(boardViewSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(boardViewSchema.safeParse({ ...state, blocked: "yes" }).success).toBe(false);
    expect(boardViewSchema.safeParse({ ...state, selectedTicket: -1 }).success).toBe(false);
  });
});

describe("shared board reads", () => {
  const missing: BoardReadResult = { kind: "missing", boardId: "/canonical/kanban", projectId: "project" };
  it("coalesces overlapping reads from sibling panels of the same canonical board", async () => {
    const read = vi.fn(async () => missing);
    const key = boardQueryKey("host", missing.boardId);
    const query = getBoardQuery(key);
    const first = query.refresh(false, read);
    const second = query.refresh(false, read);
    expect(second).toBe(first);
    expect(await first).toEqual(missing);
    expect(read).toHaveBeenCalledTimes(1);
    await query.refresh(false, read);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("isolates hosts and canonical boards, including delimiter-like names", async () => {
    const read = vi.fn(async () => missing);
    await Promise.all([
      getBoardQuery(boardQueryKey("a", "b/c")).refresh(false, read),
      getBoardQuery(boardQueryKey("a/b", "c")).refresh(false, read),
      getBoardQuery(boardQueryKey("other", "b/c")).refresh(false, read),
    ]);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("releases rejected reads so retry can succeed", async () => {
    const key = boardQueryKey("retry", missing.boardId);
    await expect(getBoardQuery(key).refresh(false, async () => { throw new Error("offline"); })).resolves.toBeUndefined();
    await expect(getBoardQuery(key).refresh(false, async () => missing)).resolves.toEqual(missing);
  });
});
