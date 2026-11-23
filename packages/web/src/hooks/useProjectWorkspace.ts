import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "@v3rne/shared";
import { describeError } from "../api/client";
import { fetchProjects, fetchProjectTasks } from "../api/projects";
import type { ProjectWithGit } from "../api/types";
import {
  acknowledgePlanDrift,
  fetchPlanDetail,
  fetchProjectDocs,
  type PlanDetail,
  type ProjectDocsResponse,
} from "../views/project/api";

export interface ProjectWorkspaceData {
  projects: ProjectWithGit[];
  tasks: Task[];
  plan: PlanDetail | null;
  planError: string | null;
  docs: ProjectDocsResponse | null;
  docsError: string | null;
}

export type ProjectWorkspaceState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProjectWorkspaceData };

type Settled<T> = { value: T; error: null } | { value: null; error: string };

/** Plan and docs can fail without taking the whole workspace down. */
function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value): Settled<T> => ({ value, error: null }),
    (err: unknown): Settled<T> => ({ value: null, error: describeError(err) }),
  );
}

export function useProjectWorkspace(projectId: string) {
  const [state, setState] = useState<ProjectWorkspaceState>({ status: "loading" });
  const projectRef = useRef(projectId);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const loadId = ++loadRef.current;
    setState({ status: "loading" });
    try {
      const [projects, tasks, plan, docs] = await Promise.all([
        fetchProjects(),
        fetchProjectTasks(projectId),
        settle(fetchPlanDetail(projectId)),
        settle(fetchProjectDocs(projectId)),
      ]);
      if (loadId !== loadRef.current) return;
      setState({
        status: "ready",
        data: {
          projects,
          tasks,
          plan: plan.value,
          planError: plan.error,
          docs: docs.value,
          docsError: docs.error,
        },
      });
    } catch (err) {
      if (loadId !== loadRef.current) return;
      setState({ status: "error", message: describeError(err) });
    }
  }, [projectId]);

  useEffect(() => {
    projectRef.current = projectId;
    void load();
  }, [projectId, load]);

  const refreshTasks = useCallback(async () => {
    const tasks = await fetchProjectTasks(projectId);
    if (projectRef.current !== projectId) return;
    setState((previous) =>
      previous.status === "ready" ? { status: "ready", data: { ...previous.data, tasks } } : previous,
    );
  }, [projectId]);

  const refreshProjects = useCallback(async () => {
    const projects = await fetchProjects();
    if (projectRef.current !== projectId) return;
    setState((previous) =>
      previous.status === "ready" ? { status: "ready", data: { ...previous.data, projects } } : previous,
    );
  }, [projectId]);

  const acknowledgeDrift = useCallback(async () => {
    const plan = await acknowledgePlanDrift(projectId);
    if (projectRef.current !== projectId) return;
    setState((previous) =>
      previous.status === "ready"
        ? { status: "ready", data: { ...previous.data, plan, planError: null } }
        : previous,
    );
  }, [projectId]);

  return { state, reload: load, refreshTasks, refreshProjects, acknowledgeDrift };
}
