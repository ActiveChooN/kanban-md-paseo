import { defineAttachmentSource, defineRpc, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { z } from "zod";

// Paseo calls attachment search with `{ query }` only: no workspace or project identity.
export const ticketSearch = defineRpc({
  name: "ticket.search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const ticketAttachmentSource = defineAttachmentSource({
  id: "kanban-ticket",
  title: "Kanban ticket",
  icon: "Columns3",
  pickerTitle: "Attach Kanban ticket",
  searchPlaceholder: "Search tickets by #ID, title or project",
  search: ticketSearch,
});
