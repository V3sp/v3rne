import { stat } from "node:fs/promises";
import path from "node:path";
import { runGit, stdoutOrNull, type GitCommandResult } from "./git-runner";

export const TASK_CODE_IN_MESSAGE_REGEX = /\[([A-Z]+-\d+)\]/;

const COMMIT_LOG_LIMIT = 40;
const COMMIT_LOG_FORMAT = "%H|%h|%aI|%an|%s";
const CHANGED_FILES_LIMIT = 500;
const RECENTLY_TOUCHED_FILES_LIMIT = 200;
const BRANCH_REF_FORMAT =
  "%(refname:short)|%(objectname:short)|%(committerdate:iso-strict)|%(upstream:short)";
/** Record separator prefixing each commit date in the `--name-only` log. */
const RECENT_TOUCH_COMMIT_MARKER = "\u001e";

export interface GitCommit {
  hash: string;
  shortHash: string;
  /** Author date in ISO 8601 (`%aI`). */
  date: string;
  author: string;
  subject: string;
  /** Task code extracted from the subject, e.g. `[WFC-14]` → `WFC-14`. */
  taskCode: string | null;
}

export interface GitWorktree {
  path: string;
  /** `null` for detached worktrees and bare repositories. */
  branch: string | null;
}

export interface GitBranch {
  name: string;
  lastCommitHash: string;
  /** Committer date in ISO 8601 (`%(committerdate:iso-strict)`). */
  lastCommitAt: string;
  /** Upstream branch in short form, or `null` when the branch has no upstream. */
  upstream: string | null;
}

export interface GitChangedFile {
  path: string;
  /** Two-letter porcelain status code (XY), e.g. ` M`, `??`, `A `, `D `. */
  status: string;
}

export interface GitTouchedFile {
  path: string;
  /** Committer date (ISO 8601) of the newest commit that changed this path. */
  lastChangedAt: string;
}

export interface GitSnapshot {
  repoPath: string;
  branch: string | null;
  dirtyFiles: number;
  worktrees: GitWorktree[];
  branches: GitBranch[];
  ahead: number;
  behind: number;
  commits: GitCommit[];
  lastCommit: GitCommit | null;
  /** Modified, added, deleted and untracked paths, capped at 500 entries. */
  changedFiles: GitChangedFile[];
  /** True when `git status` reported more entries than `CHANGED_FILES_LIMIT`. */
  changedFilesTruncated: boolean;
  /** Unique paths from the last 40 commits, newest first, capped at 200 entries. */
  recentlyTouchedFiles: GitTouchedFile[];
  /** True when `git log` reported more unique paths than `RECENTLY_TOUCHED_FILES_LIMIT`. */
  recentlyTouchedFilesTruncated: boolean;
  /** Set by the poller when the latest refresh failed and this snapshot is kept. */
  stale?: boolean;
  /** ISO 8601 timestamp of the failed refresh that marked the snapshot stale. */
  lastErrorAt?: string;
  /** Reason of the failed refresh; `error` stays unset so the snapshot still reads as usable. */
  lastError?: string;
  /** Present only when the repository could not be read at all. */
  error?: string;
}

export async function collectGitSnapshot(
  repoPath: string,
  options: { timeoutMs?: number } = {},
): Promise<GitSnapshot> {
  const empty: GitSnapshot = {
    repoPath,
    branch: null,
    dirtyFiles: 0,
    worktrees: [],
    branches: [],
    ahead: 0,
    behind: 0,
    commits: [],
    lastCommit: null,
    changedFiles: [],
    changedFilesTruncated: false,
    recentlyTouchedFiles: [],
    recentlyTouchedFilesTruncated: false,
  };
  const run = (args: string[]) => runGit(args, { cwd: repoPath, timeoutMs: options.timeoutMs });

  let repoStat;
  try {
    repoStat = await stat(repoPath);
  } catch {
    return { ...empty, error: `Repository path does not exist: ${repoPath}` };
  }
  if (!repoStat.isDirectory()) {
    return { ...empty, error: `Repository path is not a directory: ${repoPath}` };
  }

  const probe = await run(["rev-parse", "--git-dir"]);
  if (probe.exitCode !== 0) {
    return { ...empty, error: await repositoryError(repoPath, probe) };
  }

  const [branch, status, worktreeList, tracking, log, branchList, recentLog] = await Promise.all([
    run(["rev-parse", "--abbrev-ref", "HEAD"]),
    run(["status", "--porcelain"]),
    run(["worktree", "list", "--porcelain"]),
    run(["rev-list", "--left-right", "--count", "HEAD...@{u}"]),
    run(["log", `-n`, String(COMMIT_LOG_LIMIT), `--format=${COMMIT_LOG_FORMAT}`]),
    run(["for-each-ref", `--format=${BRANCH_REF_FORMAT}`, "refs/heads"]),
    run([
      "log",
      `-n`,
      String(COMMIT_LOG_LIMIT),
      "--name-only",
      `--format=${RECENT_TOUCH_COMMIT_MARKER}%aI`,
    ]),
  ]);

  const statusOut = stdoutOrNull(status);
  const worktreeOut = stdoutOrNull(worktreeList);
  const logOut = stdoutOrNull(log);
  const branchListOut = stdoutOrNull(branchList);
  const recentLogOut = stdoutOrNull(recentLog);
  const trackingCounts = parseTrackingCounts(stdoutOrNull(tracking));
  const commits = logOut === null ? [] : parseCommitLog(logOut);
  const changed = statusOut === null ? { files: [], truncated: false } : parseChangedFiles(statusOut);
  const touched =
    recentLogOut === null ? { files: [], truncated: false } : parseRecentlyTouchedFiles(recentLogOut);

  // `rev-parse --abbrev-ref HEAD` fails on an unborn branch; symbolic-ref still knows the name.
  const branchName =
    parseBranch(stdoutOrNull(branch)) ??
    parseBranch(stdoutOrNull(await run(["symbolic-ref", "--short", "HEAD"])));

  return {
    repoPath,
    branch: branchName,
    dirtyFiles: statusOut === null ? 0 : countDirtyFiles(statusOut),
    worktrees: worktreeOut === null ? [] : parseWorktrees(worktreeOut),
    branches: branchListOut === null ? [] : parseBranches(branchListOut),
    ahead: trackingCounts.ahead,
    behind: trackingCounts.behind,
    commits,
    lastCommit: commits[0] ?? null,
    changedFiles: changed.files,
    changedFilesTruncated: changed.truncated,
    recentlyTouchedFiles: touched.files,
    recentlyTouchedFilesTruncated: touched.truncated,
  };
}

/**
 * Distinguishes a plain directory from a repository whose `.git` entry exists
 * but cannot be read (deleted HEAD, a gitfile with garbage, broken metadata).
 */
async function repositoryError(repoPath: string, probe: GitCommandResult): Promise<string> {
  const detail = probe.stderr.trim();
  const summary = (await pathExists(path.join(repoPath, ".git")))
    ? `Broken git repository: ${repoPath}`
    : `Not a git repository: ${repoPath}`;
  return detail ? `${summary} (${detail})` : summary;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function parseBranch(stdout: string | null): string | null {
  const value = stdout?.trim();
  if (!value || value === "HEAD") return null;
  return value;
}

export function countDirtyFiles(stdout: string): number {
  return stdout.split("\n").filter((line) => line.trim().length > 0).length;
}

export function parseTrackingCounts(stdout: string | null): { ahead: number; behind: number } {
  if (stdout === null) return { ahead: 0, behind: 0 };
  const [aheadRaw, behindRaw] = stdout.trim().split(/\s+/);
  const ahead = Number.parseInt(aheadRaw ?? "", 10);
  const behind = Number.parseInt(behindRaw ?? "", 10);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
    return { ahead: 0, behind: 0 };
  }
  return { ahead, behind };
}

export function parseWorktrees(stdout: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let current: GitWorktree | null = null;

  const flush = () => {
    if (current) worktrees.push(current);
    current = null;
  };

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    const separator = line.indexOf(" ");
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1);

    if (key === "worktree") {
      flush();
      current = { path: value, branch: null };
    } else if (key === "branch" && current) {
      current.branch = value.replace(/^refs\/heads\//, "");
    }
  }
  flush();

  return worktrees;
}

export function parseBranches(stdout: string): GitBranch[] {
  const branches: GitBranch[] = [];

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const [name, lastCommitHash, lastCommitAt, upstream] = line.split("|");
    if (!name || !lastCommitHash || !lastCommitAt) continue;
    branches.push({
      name,
      lastCommitHash,
      lastCommitAt,
      upstream: upstream && upstream.length > 0 ? upstream : null,
    });
  }

  return branches;
}

export function parseChangedFiles(
  stdout: string,
  limit: number = CHANGED_FILES_LIMIT,
): { files: GitChangedFile[]; truncated: boolean } {
  const entries: GitChangedFile[] = [];

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const status = line.slice(0, 2);
    // Porcelain v1 is `XY PATH`; drop the separator space but keep the path as reported.
    const path = line.slice(2).replace(/^ /, "");
    if (path.length === 0) continue;
    entries.push({ path, status });
  }

  return { files: entries.slice(0, limit), truncated: entries.length > limit };
}

export function parseRecentlyTouchedFiles(
  stdout: string,
  limit: number = RECENTLY_TOUCHED_FILES_LIMIT,
): { files: GitTouchedFile[]; truncated: boolean } {
  const newestChangeByPath = new Map<string, string>();
  let commitDate: string | null = null;

  // `git log` walks newest first, so the first occurrence of a path is its latest change.
  for (const line of stdout.split("\n")) {
    if (line.startsWith(RECENT_TOUCH_COMMIT_MARKER)) {
      commitDate = line.slice(RECENT_TOUCH_COMMIT_MARKER.length).trim();
      continue;
    }
    const path = line.replace(/\r$/, "");
    if (path.length === 0 || commitDate === null || newestChangeByPath.has(path)) continue;
    newestChangeByPath.set(path, commitDate);
  }

  const files = [...newestChangeByPath]
    .slice(0, limit)
    .map(([path, lastChangedAt]) => ({ path, lastChangedAt }));
  return { files, truncated: newestChangeByPath.size > limit };
}

export function parseCommitLog(stdout: string): GitCommit[] {
  const commits: GitCommit[] = [];

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const parts = line.split("|");
    if (parts.length < 5) continue;

    const [hash, shortHash, date, author] = parts as [string, string, string, string];
    // The subject is last and may itself contain pipes.
    const subject = parts.slice(4).join("|").trim();
    commits.push({
      hash,
      shortHash,
      date,
      author,
      subject,
      taskCode: extractTaskCode(subject),
    });
  }

  return commits;
}

export function extractTaskCode(subject: string): string | null {
  return TASK_CODE_IN_MESSAGE_REGEX.exec(subject)?.[1] ?? null;
}
