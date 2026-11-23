import { z } from "zod";
import { CommentKindSchema, AuthorTypeSchema } from "./enums";

export const CommentSchema = z.object({
  id: z.number().int().positive(),
  taskId: z.number().int().positive(),
  authorType: AuthorTypeSchema,
  authorName: z.string().min(1),
  kind: CommentKindSchema.default("comment"),
  body: z.string().min(1),
  isResolved: z.boolean().default(false),
  resolvedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Comment = z.infer<typeof CommentSchema>;