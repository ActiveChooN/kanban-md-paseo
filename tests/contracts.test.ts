import { describe, expect, it } from "vitest";
import { boardRead, boardCreate, ticketRead, ticketCreate, ticketUpdate, ticketMove } from "../shared/rpc";

const ticket = {
  id: 1,
  title: "Keep Markdown authoritative",
  status: "custom-review",
  priority: "urgent",
  assignee: null,
  tags: [],
  due: null,
  blocked: false,
  blockReason: null,
  dependsOn: [],
  claim: null,
};

describe("domain RPC contracts", () => {
  it("defines only the six approved operations and requires workspace identity", () => {
    const contracts = [boardRead, boardCreate, ticketRead, ticketCreate, ticketUpdate, ticketMove];
    expect(contracts.map(({ name }) => name)).toEqual([
      "board.read", "board.create", "ticket.read", "ticket.create", "ticket.update", "ticket.move",
    ]);
    for (const contract of contracts) {
      expect(contract.input.safeParse({}).success).toBe(false);
    }
    expect(boardRead.input.parse({ workspaceId: "workspace-a" })).toEqual({ workspaceId: "workspace-a" });
    expect(boardCreate.input.safeParse({ workspaceId: "workspace-a", path: "/tmp/other-board" }).success).toBe(false);
    expect(ticketRead.input.safeParse({ workspaceId: "workspace-a", ticketId: 0 }).success).toBe(false);
  });

  it("keeps missing boards distinct from a validated configured board", () => {
    const identity = { boardId: "physical-board", projectId: "project-a" };
    expect(boardRead.output.parse({ ...identity, kind: "missing" }).kind).toBe("missing");
    const snapshot = {
      ...identity,
      kind: "ready",
      config: {
        name: "Custom workflow",
        statuses: [{ name: "custom-review", wipLimit: 2, requireClaim: true }],
        priorities: ["urgent"],
        defaults: { status: "custom-review", priority: "urgent" },
      },
      tickets: [ticket],
    };
    expect(boardRead.output.parse(snapshot)).toEqual(snapshot);
    expect(boardRead.output.safeParse({ ...identity, kind: "ready" }).success).toBe(false);
    expect(boardCreate.output.safeParse({ ...identity, kind: "missing" }).success).toBe(false);
    expect(boardRead.output.safeParse({ ...snapshot, tickets: [{ ...ticket, description: "detail only" }] }).success).toBe(false);
    expect(ticketRead.output.parse({ ...ticket, ...identity, description: "# Acceptance\n- Preserve metadata", revision: "opaque-hash" })).toMatchObject({ revision: "opaque-hash" });
  });

  it("requires revisions and sends only changed fields", () => {
    const input = { workspaceId: "workspace-a", ticketId: 1, revision: "opaque-hash" };
    expect(ticketUpdate.input.parse({ ...input, changes: { description: "" } }).changes).toEqual({ description: "" });
    expect(ticketUpdate.input.parse({ ...input, changes: { due: null, blockReason: null, tags: [] } }).changes).toEqual({ due: null, blockReason: null, tags: [] });
    for (const changes of [{}, { title: undefined }, { status: "done" }, { assignee: "" }, { assignee: null }, { claim: "agent" }, { dependsOn: [] }, { command: "rm" }, { due: "2026-02-30" }]) {
      expect(ticketUpdate.input.safeParse({ ...input, changes }).success).toBe(false);
    }
    expect(ticketUpdate.input.safeParse({ workspaceId: "workspace-a", ticketId: 1, changes: { title: "Changed" } }).success).toBe(false);
    expect(ticketMove.input.parse({ ...input, status: "custom-review" }).status).toBe("custom-review");
    expect(ticketMove.input.safeParse({ ...input, revision: "", status: "done" }).success).toBe(false);
  });

  it("preserves literal descriptions and excludes unsupported creation fields", () => {
    const input = { workspaceId: "workspace-a", title: "A ticket", description: "$(touch /tmp/nope)\n`literal`" };
    expect(ticketCreate.input.parse(input)).toEqual(input);
    for (const extra of [{ blockReason: "Later" }, { status: "done" }, { path: "/tmp/board" }]) {
      expect(ticketCreate.input.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });

  it("returns typed mutation failures without changing successful read shapes", () => {
    const error = { kind: "error", code: "conflict", message: "Keep the draft", cliCode: null };
    for (const contract of [boardCreate, ticketCreate, ticketUpdate, ticketMove]) {
      expect(contract.output.parse(error)).toEqual(error);
      expect(contract.output.parse({ ...error, code: "write_uncertain" })).toMatchObject({ code: "write_uncertain" });
    }
  });
});
