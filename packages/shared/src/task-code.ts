import { z } from "zod";

export const TASK_CODE_REGEX = /^[A-Z]+-\d+$/;

export const TaskCodeSchema = z.string().regex(TASK_CODE_REGEX, "Task code must match PREFIX-NUMBER");
export type TaskCode = z.infer<typeof TaskCodeSchema>;