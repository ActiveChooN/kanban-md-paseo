import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { BoardConfig } from "../shared/board";
import type { ticketCreate, ticketMove, ticketRead, ticketUpdate } from "../shared/rpc";
import { ticketCreateInputSchema, ticketUpdateInputSchema, type TicketDetail, type TicketChanges } from "../shared/ticket";

type TicketResult = RpcOutput<typeof ticketRead>;
export type Draft = ReturnType<typeof draftFrom>;
export function draftFrom(ticket: TicketDetail | null, config: BoardConfig) {
  return { title: ticket?.title ?? "", description: ticket?.description ?? "", priority: ticket?.priority ?? config.defaults.priority,
    assignee: ticket?.assignee ?? "", tags: [...(ticket?.tags ?? [])], blocked: ticket?.blocked ?? false, due: ticket?.due ?? "", blockReason: ticket?.blockReason ?? "" };
}
function fields(draft: Draft) {
  return { ...draft, due: draft.due || null, blockReason: draft.blocked ? draft.blockReason.trim() : null };
}
export function changedFields(draft: Draft, baseline: TicketDetail): TicketChanges {
  const next = fields(draft);
  return {
    ...(next.title !== baseline.title ? { title: next.title } : {}),
    ...(next.description !== baseline.description ? { description: next.description } : {}),
    ...(next.priority !== baseline.priority ? { priority: next.priority } : {}),
    ...(next.assignee !== (baseline.assignee ?? "") ? { assignee: next.assignee } : {}),
    ...(JSON.stringify(next.tags) !== JSON.stringify(baseline.tags) ? { tags: next.tags } : {}),
    ...(next.due !== baseline.due ? { due: next.due } : {}),
    ...(draft.blocked !== baseline.blocked || (draft.blocked && draft.blockReason !== (baseline.blockReason ?? "")) ? { blockReason: next.blockReason } : {}),
  };
}

// One instance lives for one host/board/ticket editor; polling never writes into it.
export class TicketDraft {
  draft: Draft;
  pending = false;
  error = "";
  recovery: "none" | "conflict" | "uncertain" = "none";
  latest: TicketDetail | null = null;
  reconciled = false;
  constructor(public baseline: TicketDetail | null, readonly config: BoardConfig) {
    this.draft = draftFrom(baseline, config);
  }
  get dirty() { return JSON.stringify(this.draft) !== JSON.stringify(draftFrom(this.baseline, this.config)); }
  get canLeave() { return !this.pending && !this.dirty && this.recovery === "none"; }
  accept(ticket: TicketDetail) {
    this.baseline = ticket;
    this.draft = draftFrom(ticket, this.config);
    this.latest = null;
    this.recovery = "none";
    this.reconciled = false;
    this.error = "";
  }
  async mutate(run: () => Promise<TicketResult>, notify: () => void) {
    if (this.pending || this.recovery !== "none") return false;
    this.pending = true;
    this.error = "";
    notify();
    try {
      const result = await run();
      if ("kind" in result) {
        this.error = result.message;
        if (result.code === "conflict") this.recovery = "conflict";
        if (["write_uncertain", "timeout", "output_limit", "invalid_output"].includes(result.code)) this.recovery = "uncertain";
        return false;
      }
      this.accept(result);
      return true;
    } catch {
      this.error = "The response was lost. Refresh saved data before another write; your draft is retained.";
      this.recovery = "uncertain";
      return false;
    } finally { this.pending = false; notify(); }
  }
  async save(workspaceId: string, create: (input: RpcInput<typeof ticketCreate>) => Promise<TicketResult>,
    update: (input: RpcInput<typeof ticketUpdate>) => Promise<TicketResult>, notify: () => void) {
    if (this.pending || this.recovery !== "none") return false;
    if (this.baseline) {
      const changes = changedFields(this.draft, this.baseline);
      if (Object.keys(changes).length === 0) { this.accept(this.baseline); notify(); return true; }
      const parsed = ticketUpdateInputSchema.safeParse({ workspaceId, ticketId: this.baseline.id, revision: this.baseline.revision, changes });
      if (!parsed.success) { this.error = "Check title, tags, assignee and due date. Blocking requires a reason; use the Blocked switch to unblock. Assignee can be replaced but cannot be cleared. Dates use YYYY-MM-DD."; notify(); return false; }
      return this.mutate(() => update(parsed.data), notify);
    }
    const next = fields(this.draft);
    const parsed = ticketCreateInputSchema.safeParse({ workspaceId, title: next.title, description: next.description,
      priority: next.priority, ...(next.assignee ? { assignee: next.assignee } : {}), tags: next.tags, ...(next.due ? { due: next.due } : {}) });
    if (!parsed.success) { this.error = "Enter a title, nonempty tags and a valid due date in YYYY-MM-DD format."; notify(); return false; }
    return this.mutate(() => create(parsed.data), notify);
  }
  async move(workspaceId: string, status: string, move: (input: RpcInput<typeof ticketMove>) => Promise<TicketResult>, notify: () => void) {
    const baseline = this.baseline;
    if (!baseline || this.dirty) return false;
    return this.mutate(() => move({ workspaceId, ticketId: baseline.id, revision: baseline.revision, status }), notify);
  }
}
