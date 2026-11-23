import type { Task } from "@v3rne/shared";
import { apiRequest } from "./client";
import type { GitSnapshot, PlanState, ProjectWithGit } from "./types";

export async function fetchProjects(): Promise<ProjectWithGit[]> {
  const body = await apiRequest<{ projects: ProjectWithGit[] }>("/projects");
  return body.projects;
}

export async function fetchProjectTasks(projectId: string): Promise<Task[]> {
  const body = await apiRequest<{ tasks: Task[] }>(
    `/projects/${encodeURIComponent(projectId)}/tasks`,
  );
  return body.tasks;
}

export function fetchProjectPlan(projectId: string): Promise<PlanState> {
  return apiRequest<PlanState>(`/projects/${encodeURIComponent(projectId)}/plan`);
}

export function refreshProjectGit(projectId: string): Promise<GitSnapshot> {
  return apiRequest<GitSnapshot>(`/projects/${encodeURIComponent(projectId)}/refresh`, {
    method: "POST",
  });
}
