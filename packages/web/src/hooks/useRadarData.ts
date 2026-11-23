import { useCallback, useEffect, useRef, useState } from "react";
import { fetchProjectPlan, fetchProjectTasks, fetchProjects } from "../api/projects";
import { describeError } from "../api/client";
import type { ProjectWithGit } from "../api/types";
import type { RadarEntry } from "../lib/radar";

export type RadarLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: RadarEntry[] };

interface RadarSyncState {
  /** ISO time of the last successful load, manual or silent. */
  lastSyncedAt: string | null;
  /** True after a silent reload failed; the last good data stays on screen. */
  syncFailed: boolean;
}

export function useRadarData() {
  const [state, setState] = useState<RadarLoadState>({ status: "loading" });
  const [sync, setSync] = useState<RadarSyncState>({ lastSyncedAt: null, syncFailed: false });
  const silentInFlight = useRef(false);

  const load = useCallback(async () => {
    // Keep showing the last good data while reloading so the screen does not flash.
    setState((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    try {
      const entries = await loadEntries();
      setState({ status: "ready", entries });
      setSync({ lastSyncedAt: new Date().toISOString(), syncFailed: false });
    } catch (err) {
      setState({ status: "error", message: describeError(err) });
    }
  }, []);

  /** Background refresh: never shows the loader and never replaces data with an error. */
  const reloadSilently = useCallback(async () => {
    if (silentInFlight.current) return;
    silentInFlight.current = true;
    try {
      const entries = await loadEntries();
      setState({ status: "ready", entries });
      setSync({ lastSyncedAt: new Date().toISOString(), syncFailed: false });
    } catch {
      setSync((previous) => ({ ...previous, syncFailed: true }));
    } finally {
      silentInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    state,
    reload: load,
    reloadSilently,
    lastSyncedAt: sync.lastSyncedAt,
    syncFailed: sync.syncFailed,
  };
}

async function loadEntries(): Promise<RadarEntry[]> {
  const projects = await fetchProjects();
  return Promise.all(projects.map(loadEntry));
}

async function loadEntry(project: ProjectWithGit): Promise<RadarEntry> {
  const [tasks, plan] = await Promise.allSettled([
    fetchProjectTasks(project.id),
    fetchProjectPlan(project.id),
  ]);
  return {
    project,
    tasks: tasks.status === "fulfilled" ? tasks.value : null,
    plan: plan.status === "fulfilled" ? plan.value : null,
  };
}
