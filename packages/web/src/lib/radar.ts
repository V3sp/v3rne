import type { Task } from "@v3rne/shared";
import type { PlanState, ProjectWithGit } from "../api/types";
import { summarizeProgress, type ProgressSummary } from "./format";

export interface RadarEntry {
  project: ProjectWithGit;
  /** `null` when the task list could not be loaded for this project. */
  tasks: Task[] | null;
  /** `null` when the plan state could not be loaded for this project. */
  plan: PlanState | null;
}

export interface RadarSummary {
  monitored: number;
  progress: ProgressSummary;
  openDoubts: number;
  driftAlerts: number;
}

/**
 * A task in `needs_input` is the open doubt: the server sets that status whenever a doubt is
 * opened and clears it once the last doubt is resolved.
 */
export function countOpenDoubts(tasks: readonly Pick<Task, "status">[] | null): number {
  return tasks?.filter((task) => task.status === "needs_input").length ?? 0;
}

export function summarizeRadar(entries: readonly RadarEntry[]): RadarSummary {
  const active = entries.filter((entry) => entry.project.active);
  const tasks = active.flatMap((entry) => entry.tasks ?? []);
  return {
    monitored: active.length,
    progress: summarizeProgress(tasks),
    openDoubts: active.reduce((sum, entry) => sum + countOpenDoubts(entry.tasks), 0),
    driftAlerts: active.filter((entry) => entry.plan?.drift === true).length,
  };
}
