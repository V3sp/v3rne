import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

export type PlanFileOrigin = "file" | "dir";

export interface PlanSourcesInput {
  /** Explicitly configured paths, relative to the repository root. Always kept. */
  planFiles: string[];
  /** Repository-relative directories scanned recursively for `*.md` files. */
  planDirs: string[];
  /** Directory names skipped at every scanned level. */
  excludeDirs: string[];
  /** Upper bound for the resolved list, explicit files included. */
  maxFiles?: number;
}

export interface PlanSources {
  /** Explicit files first (configured order), then directory hits sorted by path. */
  files: string[];
  truncated: boolean;
}

export const DEFAULT_MAX_PLAN_FILES = 200;
export const MAX_PLAN_DIR_DEPTH = 3;

/**
 * Builds the effective plan file list: every explicit `planFiles` entry (even a missing one) plus
 * all `*.md` files found in `planDirs` up to `MAX_PLAN_DIR_DEPTH`. Missing directories and symlinks
 * are skipped silently; the scan stops at `maxFiles`.
 */
export async function resolvePlanSources(
  repoPath: string,
  input: PlanSourcesInput,
): Promise<PlanSources> {
  const repoRoot = path.resolve(repoPath);
  const maxFiles = input.maxFiles ?? DEFAULT_MAX_PLAN_FILES;
  const exclude = new Set(input.excludeDirs.map((name) => name.toLowerCase()));

  const seen = new Set<string>();
  const explicit: string[] = [];
  for (const file of input.planFiles) {
    const key = file.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    explicit.push(file);
  }

  const discovered: string[] = [];
  let truncated = false;

  const walk = async (absoluteDir: string, relativeDir: string, depth: number): Promise<void> => {
    const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;

    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (truncated) return;

      const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (depth >= MAX_PLAN_DIR_DEPTH) continue;
        if (exclude.has(entry.name.toLowerCase())) continue;
        await walk(path.join(absoluteDir, entry.name), relativePath, depth + 1);
        continue;
      }

      // Symlinks are neither files nor directories in a Dirent, so they are never followed.
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;

      const key = relativePath.toLowerCase();
      if (seen.has(key)) continue;
      if (seen.size >= maxFiles) {
        truncated = true;
        return;
      }
      seen.add(key);
      discovered.push(relativePath);
    }
  };

  for (const relativeDir of input.planDirs) {
    if (truncated) break;

    const absoluteDir = path.resolve(repoRoot, relativeDir);
    if (!isInside(repoRoot, absoluteDir)) continue;
    const info = await lstat(absoluteDir).catch(() => null);
    if (!info?.isDirectory()) continue;

    await walk(absoluteDir, toPosix(path.relative(repoRoot, absoluteDir)), 0);
  }

  discovered.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { files: [...explicit, ...discovered], truncated };
}

/** Lower-cased path -> `file` for explicit entries; everything else resolved from a directory. */
export function planFileOrigins(planFiles: string[]): Map<string, PlanFileOrigin> {
  const origins = new Map<string, PlanFileOrigin>();
  for (const file of planFiles) origins.set(file.toLowerCase(), "file");
  return origins;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
