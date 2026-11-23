import path from "node:path";
import type { Database } from "bun:sqlite";
import type { Config } from "../config";
import { ApiError } from "../api/tasks";
import type { PlanHeading } from "../git/plan-parser";
import { readPlanFiles, type PlanFileResult } from "../git/plan-files";
import {
  planFileOrigins,
  resolvePlanSources,
  type PlanFileOrigin,
} from "../git/plan-sources";

export interface McpProjectRow {
  id: string;
  code_prefix: string;
  name: string;
  rel_path: string;
  plan_files_json: string;
  plan_dirs_json: string | null;
  agent_docs_json: string;
  plan_hashes_json: string;
  next_task_seq: number;
  active: number;
  created_at: string;
}

export type PlanDriftStatus = "clean" | "untracked" | "drift" | "missing" | "error";

export interface ProjectPlanFile {
  path: string;
  origin: PlanFileOrigin;
  exists: boolean;
  hash: string | null;
  storedHash: string | null;
  driftStatus: PlanDriftStatus;
  headings: PlanHeading[];
  error?: string;
}

export interface ProjectPlanState {
  /** False when the workspace root is missing or the project path escapes it. */
  available: boolean;
  repoPath: string | null;
  files: ProjectPlanFile[];
  /** True when the plan directory scan hit its file limit. */
  truncated: boolean;
  error?: string;
}

export function listProjectRows(db: Database, onlyActive: boolean): McpProjectRow[] {
  const where = onlyActive ? "WHERE active = 1" : "";
  return db
    .query<McpProjectRow, []>(
      `SELECT * FROM projects ${where} ORDER BY name COLLATE NOCASE, id`,
    )
    .all();
}

export function findProjectRow(db: Database, id: string): McpProjectRow | null {
  return db.query<McpProjectRow, [string]>("SELECT * FROM projects WHERE id = ?").get(id) ?? null;
}

import { resolveWorkspaceRoot } from "../workspace";

export { resolveWorkspaceRoot };

/** Absolute repository path, or `null` when the workspace is missing or `relPath` escapes it. */
export function projectRepoPath(config: Config, project: McpProjectRow): string | null {
  const root = resolveWorkspaceRoot(config);
  if (!root) return null;

  const resolved = path.resolve(root, project.rel_path);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

/**
 * Resolves a project by explicit id or by an absolute `cwd` inside the workspace.
 * When both are given, `project_id` wins. Throws `ApiError` when nothing matches.
 */
export function resolveProject(
  db: Database,
  config: Config,
  cwd?: string | null,
  projectId?: string | null,
): McpProjectRow {
  if (projectId) {
    const row = findProjectRow(db, projectId);
    if (!row) throw new ApiError(404, "project_not_found", `Project "${projectId}" was not found`);
    return row;
  }
  if (cwd) return resolveProjectByCwd(db, config, cwd);

  throw new ApiError(400, "project_required", "Provide either project_id or cwd");
}

export function resolveProjectByCwd(db: Database, config: Config, cwd: string): McpProjectRow {
  const root = resolveWorkspaceRoot(config);
  if (!root) {
    throw new ApiError(500, "workspace_not_configured", "workspace_root is not configured");
  }

  const target = path.resolve(cwd);
  const matches: { row: McpProjectRow; repoPath: string }[] = [];
  for (const row of db.query<McpProjectRow, []>("SELECT * FROM projects").all()) {
    const repoPath = projectRepoPath(config, row);
    if (repoPath && isInsideOrEqual(repoPath, target)) matches.push({ row, repoPath });
  }

  if (matches.length === 0) {
    throw new ApiError(404, "project_not_found", `No registered project contains cwd "${target}"`);
  }
  // Nested projects are allowed, so the most specific (longest) path wins.
  matches.sort((a, b) => b.repoPath.length - a.repoPath.length);
  return matches[0]!.row;
}

export function isInsideOrEqual(ancestor: string, target: string): boolean {
  const relative = path.relative(ancestor, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function parseJsonStringArray(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function parseHashRecord(raw: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const hashes: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string") hashes[key] = entry;
    }
    return hashes;
  } catch {
    return {};
  }
}

export interface ProjectSummary {
  id: string;
  codePrefix: string;
  name: string;
  relPath: string;
  active: boolean;
  planFiles: string[];
}

export function projectSummary(row: McpProjectRow): ProjectSummary {
  return {
    id: row.id,
    codePrefix: row.code_prefix,
    name: row.name,
    relPath: row.rel_path,
    active: row.active === 1,
    planFiles: parseJsonStringArray(row.plan_files_json),
  };
}

export function projectPlanFiles(row: McpProjectRow): string[] {
  return parseJsonStringArray(row.plan_files_json);
}

/** Stored override, or the config default when the column is NULL. */
export function projectPlanDirs(row: McpProjectRow, config: Config): string[] {
  if (row.plan_dirs_json === null || row.plan_dirs_json === undefined) {
    return config.defaults.plan_dirs;
  }
  return parseJsonStringArray(row.plan_dirs_json);
}

export function projectAgentDocs(row: McpProjectRow): string[] {
  return parseJsonStringArray(row.agent_docs_json);
}

/** Reads and classifies the configured plan files; never throws for missing files or repos. */
export async function loadProjectPlanState(
  config: Config,
  project: McpProjectRow,
): Promise<ProjectPlanState> {
  const repoPath = projectRepoPath(config, project);
  if (!repoPath) {
    const error = resolveWorkspaceRoot(config)
      ? `Project relPath escapes the workspace root: ${project.rel_path}`
      : "workspace_root is not configured";
    return { available: false, repoPath: null, files: [], truncated: false, error };
  }

  const storedHashes = parseHashRecord(project.plan_hashes_json);
  const planFiles = projectPlanFiles(project);
  const sources = await resolvePlanSources(repoPath, {
    planFiles,
    planDirs: projectPlanDirs(project, config),
    excludeDirs: config.defaults.plan_dir_exclude,
  });
  const origins = planFileOrigins(planFiles);
  const results = await readPlanFiles(repoPath, sources.files);
  return {
    available: true,
    repoPath,
    truncated: sources.truncated,
    files: results.map((result) => ({
      path: result.path,
      origin: origins.get(result.path.toLowerCase()) ?? "dir",
      exists: result.exists,
      hash: result.hash,
      storedHash: storedHashes[result.path] ?? null,
      driftStatus: driftStatusFor(result, storedHashes[result.path] ?? null),
      headings: result.headings,
      ...(result.error ? { error: result.error } : {}),
    })),
  };
}

function driftStatusFor(
  result: PlanFileResult,
  storedHash: string | null,
): PlanDriftStatus {
  if (result.error) return "error";
  if (!result.exists || result.hash === null) return "missing";
  if (!storedHash) return "untracked";
  return storedHash === result.hash ? "clean" : "drift";
}
