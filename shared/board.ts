import { z } from "zod";
import { boardErrorSchema } from "./errors";
import { ticketSummarySchema } from "./ticket";

export const boardConfigSchema = z.strictObject({
  name: z.string().min(1),
  statuses: z.array(z.strictObject({
    name: z.string().min(1),
    wipLimit: z.number().int().nonnegative().nullable(),
    requireClaim: z.boolean(),
  })).min(1),
  priorities: z.array(z.string().min(1)).min(1),
  defaults: z.strictObject({ status: z.string().min(1), priority: z.string().min(1) }),
});

export const boardIdentitySchema = z.strictObject({
  // Server-derived physical identity, used only for equality and cache keys.
  boardId: z.string().min(1),
  projectId: z.string().min(1),
});

export const boardSnapshotSchema = boardIdentitySchema.extend({
  kind: z.literal("ready"),
  config: boardConfigSchema,
  tickets: z.array(ticketSummarySchema),
});

export const boardReadResultSchema = z.discriminatedUnion("kind", [
  boardSnapshotSchema,
  boardErrorSchema,
  boardIdentitySchema.extend({ kind: z.literal("missing") }),
]);

export type BoardConfig = z.infer<typeof boardConfigSchema>;
export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;
export type BoardReadResult = z.infer<typeof boardReadResultSchema>;
