import { z } from "zod";
import { StatusSchema, PrioritySchema } from "./enums";
import { TaskCodeSchema } from "./task-code";

export const TaskSchema = z.object({
  id: z.number().int().positive(),
  projectId: z.string().min(1),
  code: TaskCodeSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  planFile: z.string().nullable().default(null),
  planSection: z.string().nullable().default(null),
  status: StatusSchema.default("backlog"),
  priority: PrioritySchema.default("medium"),
  sortOrder: z.number().int().default(0),
  claimedBy: z.string().nullable().default(null),
  gitBranch: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().default(null),
});
export type Task = z.infer<typeof TaskSchema>;