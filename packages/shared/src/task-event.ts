import { z } from "zod";

export const TaskEventSchema = z.object({
  id: z.number().int().positive(),
  projectId: z.string().min(1),
  taskId: z.number().int().positive(),
  eventType: z.string().min(1),
  oldValue: z.string().nullable().default(null),
  newValue: z.string().nullable().default(null),
  actor: z.string().min(1),
  createdAt: z.string(),
});
export type TaskEvent = z.infer<typeof TaskEventSchema>;