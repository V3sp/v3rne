import type { Comment, Priority } from "@v3rne/shared";
import { apiRequest } from "./client";

export interface DoubtTask {
  code: string;
  title: string;
  priority: Priority;
  projectId: string;
  projectName: string;
}

export interface DoubtItem {
  comment: Comment;
  task: DoubtTask;
}

export interface ResolveDoubtResult {
  statusChanged: boolean;
  openDoubts: number;
}

export async function fetchDoubts(): Promise<DoubtItem[]> {
  const body = await apiRequest<{ doubts: DoubtItem[] }>("/doubts");
  return body.doubts;
}

/** The server stores the reply as a `decision` comment and unblocks the task when no doubts remain. */
export function resolveDoubt(commentId: number, reply: string): Promise<ResolveDoubtResult> {
  return apiRequest<ResolveDoubtResult>(`/comments/${commentId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ reply }),
  });
}
