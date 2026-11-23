import type { Project } from "@v3rne/shared";

// Git snapshot shapes are defined in packages/server/src/git/snapshot.ts and
// are not exported from @v3rne/shared, so the subset used by the UI is mirrored here.

export interface GitCommit {
  hash: string;
  shortHash: string;
  /** Author date, ISO 8601. */
  date: string;
  author: string;
  subject: string;
  taskCode: string | null;
}

export interface GitWorktree {
  path: string;
  branch: string | null;
}

export interface GitBranch {
  name: string;
  lastCommitHash: string;
  lastCommitAt: string;
  upstream: string | null;
}

export interface GitChangedFile {
  path: string;
  /** Skrót XY z `git status --porcelain`. */
  status: string;
}

export interface GitTouchedFile {
  path: string;
  /** Data ostatniego commita dotykającego pliku, ISO 8601. */
  lastChangedAt: string;
}

export interface GitSnapshot {
  repoPath: string;
  branch: string | null;
  dirtyFiles: number;
  worktrees: GitWorktree[];
  branches?: GitBranch[];
  changedFiles?: GitChangedFile[];
  changedFilesTruncated?: boolean;
  recentlyTouchedFiles?: GitTouchedFile[];
  recentlyTouchedFilesTruncated?: boolean;
  commits?: GitCommit[];
  ahead: number;
  behind: number;
  lastCommit: GitCommit | null;
  /** Present only when the repository could not be read at all. */
  error?: string;
  /** Last read failed, but the fields above still come from the last successful read. */
  stale?: boolean;
  /** ISO 8601 time of the most recent failed read. */
  lastErrorAt?: string | null;
}

export interface ProjectWithGit extends Project {
  git: GitSnapshot | null;
}

export type PlanDriftStatus = "clean" | "untracked" | "drift" | "missing" | "error";

/** `file` for an explicit `planFiles` entry, `dir` for a file discovered in `planDirs`. */
export type PlanFileOrigin = "file" | "dir";

export interface PlanFileState {
  path: string;
  origin: PlanFileOrigin;
  exists: boolean;
  driftStatus: PlanDriftStatus;
  error?: string;
}

export interface PlanState {
  projectId: string;
  files: PlanFileState[];
  drift: boolean;
  /** True when the plan directory scan hit its file limit. */
  truncated: boolean;
}
