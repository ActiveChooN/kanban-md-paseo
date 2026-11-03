import { expect, it, vi } from "vitest";

// The native renderer belongs to Paseo; this test exercises entry registration only.
vi.mock("../client/kanban-panel", () => ({ KanbanPanel: () => null }));

import contributeClient from "../index.client";
import contributeServer from "../index.server";
import { ticketSearch } from "../shared/attachments";

it("opens the registered workspace panel, registers the ticket attachment source and removes registrations on each reload", () => {
  const panels = new Map();
  const commands = new Map();
  const sources = new Map();
  const client = {
    addAttachmentSource(source) {
      expect(sources.has(source.id)).toBe(false);
      sources.set(source.id, source);
      return () => sources.delete(source.id);
    },
    addWorkspacePanel(panel) {
      expect(panels.has(panel.id)).toBe(false);
      panels.set(panel.id, panel);
      return () => panels.delete(panel.id);
    },
    addCommandCenterItem(command) {
      expect(commands.has(command.id)).toBe(false);
      commands.set(command.id, command);
      return () => commands.delete(command.id);
    },
  };

  for (let reload = 0; reload < 2; reload++) {
    const cleanup = contributeClient(client);
    expect(panels.size).toBe(1);
    expect(commands.size).toBe(1);
    const command = commands.get("open-kanban");
    expect(command.context).toBe("workspace");
    const openPanel = vi.fn();
    command.onSelect({ openPanel });
    expect(openPanel).toHaveBeenCalledExactlyOnceWith("kanban");
    expect(panels.get("kanban").title).toBe("Kanban");
    expect(sources.get("kanban-ticket")).toMatchObject({
      title: "Kanban ticket", icon: "Columns3", pickerTitle: "Attach Kanban ticket",
      searchPlaceholder: "Search tickets by #ID, title or project", search: ticketSearch,
    });
    cleanup();
    cleanup();
    expect(panels.size).toBe(0);
    expect(commands.size).toBe(0);
    expect(sources.size).toBe(0);
  }
});

it("registers all six board and ticket handlers plus launch and attachment search handlers and returns cleanup", () => {
  const handle = vi.fn();
  const cleanup = contributeServer({ handle });
  expect(handle.mock.calls.map(([contract]) => contract.name)).toEqual([
    "board.read", "ticket.read", "board.create", "ticket.create", "ticket.update", "ticket.move",
    "launch.options", "launch.start", "launch.recover", "ticket.search",
  ]);
  expect(cleanup).toBeTypeOf("function");
  cleanup();
});
