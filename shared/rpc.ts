import { z } from "zod";
import { boardErrorSchema } from "./errors";
import { defineRpc } from "@getpaseo/plugin";
import { boardReadResultSchema, boardSnapshotSchema } from "./board";
import {
  ticketCreateInputSchema,
  ticketDetailSchema,
  ticketInputSchema,
  ticketMoveInputSchema,
  ticketUpdateInputSchema,
  workspaceInputSchema,
} from "./ticket";

export const boardRead = defineRpc({
  name: "board.read",
  input: workspaceInputSchema,
  output: boardReadResultSchema,
});

export const boardCreate = defineRpc({
  name: "board.create",
  input: workspaceInputSchema,
  output: z.union([boardSnapshotSchema, boardErrorSchema]),
});

export const ticketRead = defineRpc({
  name: "ticket.read",
  input: ticketInputSchema,
  output: z.union([ticketDetailSchema, boardErrorSchema]),
});

export const ticketCreate = defineRpc({
  name: "ticket.create",
  input: ticketCreateInputSchema,
  output: z.union([ticketDetailSchema, boardErrorSchema]),
});

export const ticketUpdate = defineRpc({
  name: "ticket.update",
  input: ticketUpdateInputSchema,
  output: z.union([ticketDetailSchema, boardErrorSchema]),
});

export const ticketMove = defineRpc({
  name: "ticket.move",
  input: ticketMoveInputSchema,
  output: z.union([ticketDetailSchema, boardErrorSchema]),
});
