import type { GitSnapshot } from "../api/types";
import { formatRelativeTime, pluralizePl } from "./format";

/** Mirrors `RECENTLY_TOUCHED_FILES_LIMIT` in packages/server/src/git/snapshot.ts. */
export const RECENTLY_TOUCHED_FILES_LIMIT = 200;

export type BranchState =
  | { kind: "branch"; name: string }
  | { kind: "detached" }
  | { kind: "unknown" };

type GitView = Pick<GitSnapshot, "branch" | "error"> | null | undefined;

/** `null` branch with a readable repository means detached HEAD; an unreadable repository tells nothing. */
export function resolveBranchState(git: GitView): BranchState {
  if (!git || git.error) return { kind: "unknown" };
  if (git.branch) return { kind: "branch", name: git.branch };
  return { kind: "detached" };
}

/** Ahead/behind are 0 when there is no upstream, so the badge is hidden in that case too. */
export function shouldShowSyncBadge(git: Pick<GitSnapshot, "ahead" | "behind" | "error"> | null | undefined): boolean {
  if (!git || git.error) return false;
  return git.ahead > 0 || git.behind > 0;
}

export function shouldShowStaleBadge(git: Pick<GitSnapshot, "stale"> | null | undefined): boolean {
  return git?.stale === true;
}

/** `now` is injectable for tests; the time is omitted when the failure time is unknown. */
export function staleBadgeLabel(
  git: Pick<GitSnapshot, "lastErrorAt"> | null | undefined,
  now: Date = new Date(),
): string {
  const base = "dane z ostatniego udanego odczytu";
  if (!git?.lastErrorAt) return base;
  const when = formatRelativeTime(git.lastErrorAt, now);
  return when === "—" ? base : `${base} · błąd ${when}`;
}

export function isTouchedFilesTruncated(
  git: Pick<GitSnapshot, "recentlyTouchedFilesTruncated"> | null | undefined,
): boolean {
  return git?.recentlyTouchedFilesTruncated === true;
}

export function touchedFilesTruncationLabel(limit: number = RECENTLY_TOUCHED_FILES_LIMIT): string {
  return `Pokazano pierwsze ${limit} ${pluralizePl(limit, "plik", "pliki", "plików")}`;
}
