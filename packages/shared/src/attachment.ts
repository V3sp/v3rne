import { z } from "zod";

export const AttachmentSchema = z.object({
  id: z.number().int().positive(),
  taskId: z.number().int().positive(),
  commentId: z.number().int().positive().nullable().default(null),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  storagePath: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;