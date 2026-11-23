import path from "node:path";
import type { Database } from "bun:sqlite";
import type { Config } from "./config/schema";
import { collectGitSnapshot, type GitSnapshot } from "./git/snapshot";
import { getProjectSnapshot, setProjectSnapshot } from "./api/projects-state";
import { resolveWorkspaceRoot } from "./workspace";

export { resolveWorkspaceRoot };

interface ProjectPathRow {
  id: string;
  rel_path: string;
  active: number;
}

/**
 * Keeps the last good snapshot and flags it as stale, so a transient Git
 * failure does not wipe the data the UI is showing.
 */
function markStale(previous: GitSnapshot, error: string): GitSnapshot {
  return { ...previous, stale: true, lastErrorAt: new Date().toISOString(), lastError: error };
}

/**
 * Odświeża snapshoty Gita dla wszystkich aktywnych projektów.
 * Zwraca liczbę zaktualizowanych repozytoriów; błędy pojedynczego repo nie przerywają pętli.
 */
export async function refreshAllSnapshots(db: Database, config: Config): Promise<number> {
  const root = resolveWorkspaceRoot(config);
  if (!root) return 0;

  const projects = db
    .query("SELECT id, rel_path, active FROM projects WHERE active = 1")
    .all() as ProjectPathRow[];

  let updated = 0;
  for (const project of projects) {
    const repoPath = path.resolve(root, project.rel_path);
    const previous = getProjectSnapshot(project.id);

    let snapshot: GitSnapshot;
    try {
      snapshot = await collectGitSnapshot(repoPath);
    } catch (error) {
      const message = (error as Error).message;
      console.warn(`[git-poller] ${project.id}: ${message}`);
      if (previous) setProjectSnapshot(project.id, markStale(previous, message));
      continue;
    }

    if (snapshot.error !== undefined) {
      console.warn(`[git-poller] ${project.id}: ${snapshot.error}`);
      // The error snapshot replaces a good one only while none was ever read.
      setProjectSnapshot(
        project.id,
        previous && previous.error === undefined ? markStale(previous, snapshot.error) : snapshot,
      );
      continue;
    }

    setProjectSnapshot(project.id, snapshot);
    updated += 1;
  }
  return updated;
}

export interface GitPoller {
  stop: () => void;
  refreshNow: () => Promise<number>;
}

/** Uruchamia poller cykliczny; pierwsze odświeżenie wykonuje od razu. */
export function startGitPoller(db: Database, config: Config): GitPoller {
  const intervalMs = config.git_poll_interval_sec * 1000;
  let running = false;

  const refreshNow = async () => {
    if (running) return 0;
    running = true;
    try {
      return await refreshAllSnapshots(db, config);
    } finally {
      running = false;
    }
  };

  void refreshNow().catch((error) => console.warn(`[git-poller] ${(error as Error).message}`));

  const timer = setInterval(() => {
    void refreshNow().catch((error) => console.warn(`[git-poller] ${(error as Error).message}`));
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
    refreshNow,
  };
}
