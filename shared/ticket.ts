import { z } from "zod";

export const workspaceInputSchema = z.strictObject({ workspaceId: z.string().min(1) });
export const ticketIdSchema = z.number().int().positive();
export const revisionSchema = z.string().min(1);
const nameSchema = z.string().trim().min(1);

export const ticketSummarySchema = z.strictObject({
  id: ticketIdSchema,
  title: nameSchema,
  status: nameSchema,
  priority: nameSchema,
  assignee: nameSchema.nullable(),
  tags: z.array(nameSchema),
  due: z.iso.date().nullable(),
  blocked: z.boolean(),
  blockReason: z.string().nullable(),
  dependsOn: z.array(ticketIdSchema),
  claim: z.strictObject({ name: nameSchema, claimedAt: z.iso.datetime({ offset: true }) }).nullable(),
});

export const ticketDetailSchema = ticketSummarySchema.extend({
  boardId: z.string().min(1),
  projectId: z.string().min(1),
  description: z.string(),
  revision: revisionSchema,
});

export const ticketInputSchema = workspaceInputSchema.extend({ ticketId: ticketIdSchema });

export const ticketCreateInputSchema = workspaceInputSchema.extend({
  title: nameSchema,
  description: z.string().optional(),
  priority: nameSchema.optional(),
  assignee: nameSchema.optional(),
  tags: z.array(nameSchema).optional(),
  due: z.iso.date().optional(),
});

// Omission preserves a field; null clears only fields supported by the CLI.
export const ticketChangesSchema = z.strictObject({
  title: nameSchema.optional(),
  description: z.string().optional(),
  priority: nameSchema.optional(),
  assignee: nameSchema.optional(),
  tags: z.array(nameSchema).optional(),
  due: z.iso.date().nullable().optional(),
  blockReason: nameSchema.nullable().optional(),
}).refine((changes) => Object.values(changes).some((value) => value !== undefined), {
  message: "At least one changed field is required",
});

export const ticketUpdateInputSchema = ticketInputSchema.extend({
  revision: revisionSchema,
  changes: ticketChangesSchema,
});

export const ticketMoveInputSchema = ticketInputSchema.extend({
  revision: revisionSchema,
  status: nameSchema,
});

export type TicketSummary = z.infer<typeof ticketSummarySchema>;
export type TicketDetail = z.infer<typeof ticketDetailSchema>;
export type TicketChanges = z.infer<typeof ticketChangesSchema>;
