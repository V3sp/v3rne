import type { Priority, Task } from "@v3rne/shared";
import { apiRequest } from "./client";

/** Payload accepted by `POST /projects/:id/tasks` for a task created from the portal. */
export interface CreateTaskInput {
  title: string;
  description: string;
  priority: Priority;
  status: "ready";
  planFile: string | null;
  planSection: string | null;
}

/** The server assigns the task code and defaults `actor` to `human`. */
export function createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
  return apiRequest<Task>(`/projects/${encodeURIComponent(projectId)}/tasks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
