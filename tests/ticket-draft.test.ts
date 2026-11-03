import { describe, expect, it, vi } from "vitest";
import { TicketDraft, changedFields } from "../client/ticket-draft";
import type { TicketDetail } from "../shared/ticket";

import { config, ticket } from "./ticket-fixtures";
const noop = () => {};

describe("ticket draft", () => {
  it("captures defaults and sends create fields without overriding default status", async () => {
    const draft = new TicketDraft(null, config);
    draft.draft.title = "New";
    const create = vi.fn(async () => ({ ...ticket, title: "New", priority: "urgent" }));
    await draft.save("w", create, vi.fn(), noop);
    expect(create).toHaveBeenCalledWith({ workspaceId: "w", title: "New", description: "", priority: "urgent", tags: [] });
    expect(draft.baseline?.title).toBe("New");
    expect(draft.dirty).toBe(false);
  });
  it("submits only changed fields with the frozen revision, suppressing a same-tick duplicate", async () => {
    const draft = new TicketDraft(ticket, config);
    draft.draft.title = "Edited";
    let resolve: (value: TicketDetail) => void = noop;
    const update = vi.fn(() => new Promise<TicketDetail>((done) => { resolve = done; }));
    const first = draft.save("w", vi.fn(), update, noop);
    expect(draft.pending).toBe(true);
    expect(await draft.save("w", vi.fn(), update, noop)).toBe(false);
    expect(update).toHaveBeenCalledExactlyOnceWith({ workspaceId: "w", ticketId: 1, revision: "original-hash", changes: { title: "Edited" } });
    resolve({ ...ticket, title: "Edited", revision: "saved-hash" });
    expect(await first).toBe(true);
    expect(draft.baseline?.revision).toBe("saved-hash");
    expect(draft.canLeave).toBe(true);
  });
  it.each(["cli_rejected", "conflict", "write_uncertain", "timeout"] as const)("retains draft and baseline on %s", async (code) => {
    const draft = new TicketDraft(ticket, config);
    draft.draft.description = "Unsaved text";
    const update = vi.fn(async () => ({ kind: "error" as const, code, message: "Rejected", cliCode: null }));
    expect(await draft.save("w", vi.fn(), update, noop)).toBe(false);
    expect(draft.draft.description).toBe("Unsaved text");
    expect(draft.baseline).toBe(ticket);
    expect(draft.pending).toBe(false);
    if (code !== "cli_rejected") {
      await draft.save("w", vi.fn(), update, noop);
      expect(update).toHaveBeenCalledTimes(1);
    }
  });
  it("blocks writes and navigation after a lost response without resetting the draft", async () => {
    const draft = new TicketDraft(ticket, config);
    draft.draft.title = "Keep me";
    const update = vi.fn(async () => { throw new Error("disconnected"); });
    await draft.save("w", vi.fn(), update, noop);
    expect(draft.recovery).toBe("uncertain");
    expect(draft.canLeave).toBe(false);
    await draft.save("w", vi.fn(), update, noop);
    expect(update).toHaveBeenCalledTimes(1);
    expect(draft.draft.title).toBe("Keep me");
  });
  it("uses the dedicated move operation only after field edits are resolved", async () => {
    const draft = new TicketDraft(ticket, config);
    const move = vi.fn(async () => ({ ...ticket, status: "doing", revision: "moved" }));
    draft.draft.title = "dirty";
    expect(await draft.move("w", "doing", move, noop)).toBe(false);
    expect(move).not.toHaveBeenCalled();
    draft.accept(ticket);
    await draft.move("w", "doing", move, noop);
    expect(move).toHaveBeenCalledExactlyOnceWith({ workspaceId: "w", ticketId: 1, revision: "original-hash", status: "doing" });
  });
  it("validates dates and unsupported assignee clearing without writing", async () => {
    for (const changes of [{ due: "2026-02-30" }, { assignee: "" }, { title: " " }]) {
      const draft = new TicketDraft(ticket, config);
      Object.assign(draft.draft, changes);
      const update = vi.fn();
      expect(await draft.save("w", vi.fn(), update, noop)).toBe(false);
      expect(update).not.toHaveBeenCalled();
      expect(draft.dirty).toBe(true);
    }
  });
  it("clears supported fields and preserves metadata outside the form", () => {
    const baseline = { ...ticket, blocked: true, blockReason: "waiting", due: "2026-11-05" };
    const draft = new TicketDraft(baseline, config);
    Object.assign(draft.draft, { blocked: false, tags: [], due: "" });
    expect(changedFields(draft.draft, baseline)).toEqual({ blockReason: null, tags: [], due: null });
  });
});

it('preserves literal tags on unrelated edits and supports editing them without delimiters', async () => {
  const baseline = { ...ticket, tags: ['a,"quoted"', 'other,tag'] };
  const draft = new TicketDraft(baseline, config);
  draft.draft.title = "New title";
  draft.draft.description = "New body";
  const update = vi.fn(async () => baseline);
  await draft.save("w", vi.fn(), update, noop);
  expect(update.mock.calls[0]).toEqual([{ workspaceId: "w", ticketId: 1, revision: ticket.revision,
    changes: { title: "New title", description: "New body" } }]);
  draft.draft.tags[0] = 'changed,"literal"';
  expect(baseline.tags[0]).toBe('a,"quoted"');
  await draft.save("w", vi.fn(), update, noop);
  expect(update.mock.calls[1]).toEqual([{ workspaceId: "w", ticketId: 1, revision: ticket.revision,
    changes: { tags: ['changed,"literal"', 'other,tag'] } }]);
});
it('preserves reasonless blocking on unrelated edits and explicitly unblocks it', () => {
  const baseline = { ...ticket, blocked: true, blockReason: null };
  const draft = new TicketDraft(baseline, config);
  draft.draft.title = "Edited";
  expect(changedFields(draft.draft, baseline)).toEqual({ title: "Edited" });
  draft.draft.blocked = false;
  expect(changedFields(draft.draft, baseline)).toEqual({ title: "Edited", blockReason: null });
});
it('does not silently unblock when an existing reason is cleared', async () => {
  const draft = new TicketDraft({ ...ticket, blocked: true, blockReason: "waiting" }, config);
  draft.draft.blockReason = "";
  const update = vi.fn();
  expect(await draft.save("w", vi.fn(), update, noop)).toBe(false);
  expect(update).not.toHaveBeenCalled();
  expect(draft.draft.blocked).toBe(true);
});
