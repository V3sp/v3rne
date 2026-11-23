import type { Attachment, Comment, Priority, Status, Task, TaskEvent } from "@v3rne/shared";
import { apiRequest } from "../../api/client";
import type { PlanFileState } from "../../api/types";

/** Author of every mutation made from the portal UI. */
export const HUMAN_AUTHOR_NAME = "Ty";

export interface PlanHeading {
  level: 1 | 2 | 3;
  title: string;
  /** GitHub-style anchor without the leading `#`. */
  slug: string;
  /** 1-based line number in the source file. */
  line: number;
}

/** The server's plan response carries headings and hashes; the shared mirror in `api/types.ts` omits them. */
export interface PlanFileDetail extends PlanFileState {
  hash: string | null;
  storedHash: string | null;
  headings: PlanHeading[];
}

export interface PlanDetail {
  projectId: string;
  files: PlanFileDetail[];
  drift: boolean;
  truncated: boolean;
}

export interface ProjectDoc {
  path: string;
  exists: boolean;
  content: string | null;
  error?: string;
}

export interface ProjectDocsResponse {
  projectId: string;
  files: ProjectDoc[];
}

/** `GET /tasks/:code` returns the task with its thread, attachments and event log. */
export type TaskDetail = Task & {
  comments: Comment[];
  attachments: Attachment[];
  events: TaskEvent[];
};

const projectPath = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
const taskPath = (code: string) => `/tasks/${encodeURIComponent(code)}`;

export function fetchPlanDetail(projectId: string): Promise<PlanDetail> {
  return apiRequest<PlanDetail>(`${projectPath(projectId)}/plan`);
}

export function acknowledgePlanDrift(projectId: string): Promise<PlanDetail> {
  return apiRequest<PlanDetail>(`${projectPath(projectId)}/plan/ack-drift`, { method: "POST" });
}

export function fetchProjectDocs(projectId: string): Promise<ProjectDocsResponse> {
  return apiRequest<ProjectDocsResponse>(`${projectPath(projectId)}/docs`);
}

export function fetchTaskDetail(code: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(taskPath(code));
}

export function updateTask(
  code: string,
  patch: { status?: Status; priority?: Priority; sortOrder?: number },
): Promise<Task> {
  return apiRequest<Task>(taskPath(code), {
    method: "PATCH",
    body: JSON.stringify({ ...patch, actor: HUMAN_AUTHOR_NAME }),
  });
}

export function addTaskComment(code: string, body: string): Promise<Comment> {
  return apiRequest<Comment>(`${taskPath(code)}/comments`, {
    method: "POST",
    body: JSON.stringify({
      authorType: "human",
      authorName: HUMAN_AUTHOR_NAME,
      kind: "comment",
      body,
    }),
  });
}

export function resolveDoubt(commentId: number, reply: string): Promise<unknown> {
  return apiRequest<unknown>(`/comments/${commentId}/resolve`, {
    method: "POST",
    body: JSON.stringify({
      reply,
      authorType: "human",
      authorName: HUMAN_AUTHOR_NAME,
    }),
  });
}
