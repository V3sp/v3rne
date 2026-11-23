import type { GitSnapshot } from "../git/snapshot";

/**
 * Last Git snapshot per project. Snapshots are intentionally not persisted:
 * they are refreshed on demand (and by the poller) and lost on restart.
 */
const snapshots = new Map<string, GitSnapshot>();

export function setProjectSnapshot(projectId: string, snapshot: GitSnapshot): void {
  snapshots.set(projectId, snapshot);
}

export function getProjectSnapshot(projectId: string): GitSnapshot | undefined {
  return snapshots.get(projectId);
}

export function clearProjectSnapshots(): void {
  snapshots.clear();
}

export function clearProjectSnapshot(projectId: string): void {
  snapshots.delete(projectId);
}

/** Read-only view for modules that only consume snapshots. */
export const projectSnapshots: ReadonlyMap<string, GitSnapshot> = snapshots;
