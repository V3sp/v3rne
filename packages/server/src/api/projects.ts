import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { Hono, type Context } from "hono";
import { ProjectSchema, type Project } from "@v3rne/shared";
import { z } from "zod";
import type { Config } from "../config/schema";
import { detectDrift } from "../git/plan-hash";
import { readPlanFiles, validateRelativePath, type PlanFileResult } from "../git/plan-files";
import {
  planFileOrigins,
  resolvePlanSources,
  type PlanFileOrigin,
} from "../git/plan-sources";
import type { PlanHeading } from "../git/plan-parser";
import { collectGitSnapshot, type GitSnapshot } from "../git/snapshot";
import { clearProjectSnapshot, getProjectSnapshot, setProjectSnapshot } from "./projects-state";
import { resolveWorkspaceRoot } from "../workspace";

export interface ProjectsRouterDeps {
  db: Database;
  config: Config;
}

export interface ProjectWithGit extends Project {
  /** Last in-memory Git snapshot, or `null` before the project was ever refreshed. */
  git: GitSnapshot | null;
}

export type PlanDriftStatus = "clean" | "untracked" | "drift" | "missing" | "error";

export interface PlanFileState {
  path: string;
  /** `file` for an explicit `planFiles` entry, `dir` for a file discovered in `planDirs`. */
  origin: PlanFileOrigin;
  exists: boolean;
  /** Current SHA-256 of the file on disk, `null` when missing or unreadable. */
  hash: string | null;
  /** Last acknowledged hash from `projects.plan_hashes_json`. */
  storedHash: string | null;
  headings: PlanHeading[];
  driftStatus: PlanDriftStatus;
  error?: string;
}

export interface PlanState {
  projectId: string;
  files: PlanFileState[];
  /** True when at least one existing plan file differs from its acknowledged hash. */
  drift: boolean;
  /** True when the plan directory scan hit the file limit, so the list is incomplete. */
  truncated: boolean;
}

export interface DiscoveredRepo {
  relPath: string;
  name: string;
  alreadyRegistered: boolean;
}

type ErrorStatus = 400 | 404 | 409 | 500;

const ProjectIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be a lowercase slug, e.g. "workflow-core"');

const CodePrefixSchema = z
  .string()
  .regex(/^[A-Z]{2,5}$/, "codePrefix must be 2-5 uppercase letters");

const NameSchema = z.string().trim().min(1).max(200);

const RelativePathsSchema = z.array(z.string().min(1).max(500));

const PlanDirsSchema = RelativePathsSchema.nullable();

const CreateProjectSchema = z
  .object({
    id: ProjectIdSchema,
    codePrefix: CodePrefixSchema,
    name: NameSchema,
    relPath: z.string().min(1).max(500),
    planFiles: RelativePathsSchema.optional(),
    planDirs: PlanDirsSchema.optional(),
    agentDocs: RelativePathsSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict();

const PatchProjectSchema = z
  .object({
    codePrefix: CodePrefixSchema.optional(),
    name: NameSchema.optional(),
    relPath: z.string().min(1).max(500).optional(),
    planFiles: RelativePathsSchema.optional(),
    planDirs: PlanDirsSchema.optional(),
    agentDocs: RelativePathsSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict();

/**
 * Sentinel repository root for the shared relative-path guard. It must be one
 * level below the filesystem root, otherwise `path.resolve` clamps `../..`
 * and an escaping path would silently look contained.
 */
const RELATIVE_PATH_ROOT = path.join(
  path.parse(process.cwd()).root,
  "__agent_board_path_check__",
);

interface ProjectRow {
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

export function createProjectsRouter(deps: ProjectsRouterDeps): Hono {
  const { db, config } = deps;
  const router = new Hono();

  router.get("/projects", (c) => {
    const rows = db
      .query("SELECT * FROM projects ORDER BY name COLLATE NOCASE, id")
      .all() as ProjectRow[];
    const projects: ProjectWithGit[] = rows.map((row) => ({
      ...toProject(row, config),
      git: getProjectSnapshot(row.id) ?? null,
    }));
    return c.json({ projects });
  });

  router.post("/projects", async (c) => {
    const body = await readJsonBody(c);
    if (!body.ok) return body.response;

    const parsed = CreateProjectSchema.safeParse(body.value);
    if (!parsed.success) return fail(c, 400, "invalid_request", zodMessage(parsed.error));
    const input = parsed.data;
    const relPath = normalizeRelPath(input.relPath);

    const relPathRejection = projectRelPathError(relPath);
    if (relPathRejection) return fail(c, 400, "invalid_request", `relPath: ${relPathRejection}`);
    const missingRepo = await missingProjectDirectory(config, relPath);
    if (missingRepo) return fail(c, 400, "path_not_found", missingRepo);

    const planFiles = input.planFiles ?? config.defaults.plan_files;
    const planDirsOverride = input.planDirs ?? null;
    const planDirs = planDirsOverride ?? config.defaults.plan_dirs;
    const agentDocs = input.agentDocs ?? config.defaults.agent_docs;
    const pathsRejection =
      relativeFilePathsError("planFiles", planFiles) ??
      relativeFilePathsError("planDirs", planDirs) ??
      relativeFilePathsError("agentDocs", agentDocs);
    if (pathsRejection) return fail(c, 400, "invalid_request", pathsRejection);

    if (findProject(db, config, input.id)) {
      return fail(c, 409, "id_taken", `Project id already exists: ${input.id}`);
    }
    if (findProjectByRelPath(db, config, relPath)) {
      return fail(c, 409, "rel_path_taken", `Project path already registered: ${relPath}`);
    }

    const project: Project = {
      id: input.id,
      codePrefix: input.codePrefix,
      name: input.name,
      relPath,
      planFiles,
      planDirs,
      planDirsOverride: planDirsOverride !== null,
      agentDocs,
      planHashes: {},
      nextTaskSeq: 1,
      active: input.active ?? true,
      createdAt: new Date().toISOString(),
    };

    try {
      db.run(
        `INSERT INTO projects
           (id, code_prefix, name, rel_path, plan_files_json, plan_dirs_json, agent_docs_json,
            plan_hashes_json, next_task_seq, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          project.id,
          project.codePrefix,
          project.name,
          project.relPath,
          JSON.stringify(project.planFiles),
          planDirsOverride === null ? null : JSON.stringify(planDirsOverride),
          JSON.stringify(project.agentDocs),
          JSON.stringify(project.planHashes),
          project.nextTaskSeq,
          project.active ? 1 : 0,
          project.createdAt,
        ],
      );
    } catch (err) {
      // Both the primary key and rel_path are unique; a concurrent insert can still race the checks above.
      const conflict = uniqueProjectConflict(err);
      if (conflict === "rel_path_taken") {
        return fail(c, 409, "rel_path_taken", `Project path already registered: ${relPath}`);
      }
      if (conflict === "id_taken") {
        return fail(c, 409, "id_taken", `Project id already exists: ${input.id}`);
      }
      throw err;
    }

    return c.json(project, 201);
  });

  router.patch("/projects/:id", async (c) => {
    const id = c.req.param("id");
    const existing = findProject(db, config, id);
    if (!existing) return fail(c, 404, "not_found", `Project not found: ${id}`);

    const body = await readJsonBody(c);
    if (!body.ok) return body.response;

    const parsed = PatchProjectSchema.safeParse(body.value);
    if (!parsed.success) return fail(c, 400, "invalid_request", zodMessage(parsed.error));
    const input = parsed.data;

    const codePrefix = input.codePrefix ?? existing.codePrefix;
    if (codePrefix !== existing.codePrefix) {
      const taskCount = countTasks(db, id);
      if (taskCount > 0) {
        return fail(
          c,
          409,
          "code_prefix_locked",
          `Cannot change codePrefix: project has ${taskCount} task(s)`,
        );
      }
    }

    const planFiles = input.planFiles ?? existing.planFiles;
    const planDirsOverride =
      input.planDirs === undefined ? existing.planDirsOverride : input.planDirs !== null;
    const planDirs =
      input.planDirs === undefined ? existing.planDirs : (input.planDirs ?? config.defaults.plan_dirs);
    const agentDocs = input.agentDocs ?? existing.agentDocs;
    const pathsRejection =
      relativeFilePathsError("planFiles", planFiles) ??
      relativeFilePathsError("planDirs", planDirs) ??
      relativeFilePathsError("agentDocs", agentDocs);
    if (pathsRejection) return fail(c, 400, "invalid_request", pathsRejection);

    let relPath = existing.relPath;
    if (input.relPath !== undefined) {
      relPath = normalizeRelPath(input.relPath);
      const relPathRejection = projectRelPathError(relPath);
      if (relPathRejection) return fail(c, 400, "invalid_request", `relPath: ${relPathRejection}`);
      const missingRepo = await missingProjectDirectory(config, relPath);
      if (missingRepo) return fail(c, 400, "path_not_found", missingRepo);
      if (findProjectByRelPath(db, config, relPath, id)) {
        return fail(c, 409, "rel_path_taken", `Project path already registered: ${relPath}`);
      }
    }

    // Hashes of plan files that are no longer resolved would keep a stale baseline around.
    let planHashes = existing.planHashes;
    if (input.planFiles !== undefined || input.planDirs !== undefined) {
      const repoPath = resolveProjectRepo(config, { ...existing, relPath });
      if (repoPath) {
        const sources = await resolvePlanSources(repoPath, {
          planFiles,
          planDirs,
          excludeDirs: config.defaults.plan_dir_exclude,
        });
        planHashes = pickHashes(existing.planHashes, sources.files);
      } else if (input.planFiles !== undefined) {
        planHashes = pickHashes(existing.planHashes, planFiles);
      }
    }

    const updated: Project = {
      ...existing,
      codePrefix,
      name: input.name ?? existing.name,
      relPath,
      active: input.active ?? existing.active,
      planFiles,
      planDirs,
      planDirsOverride,
      agentDocs,
      planHashes,
    };

    try {
      db.run(
        `UPDATE projects
            SET code_prefix = ?, name = ?, rel_path = ?, plan_files_json = ?, plan_dirs_json = ?,
                agent_docs_json = ?, plan_hashes_json = ?, active = ?
          WHERE id = ?`,
        [
          updated.codePrefix,
          updated.name,
          updated.relPath,
          JSON.stringify(updated.planFiles),
          planDirsOverride ? JSON.stringify(planDirs) : null,
          JSON.stringify(updated.agentDocs),
          JSON.stringify(updated.planHashes),
          updated.active ? 1 : 0,
          updated.id,
        ],
      );
    } catch (err) {
      if (uniqueProjectConflict(err) === "rel_path_taken") {
        return fail(c, 409, "rel_path_taken", `Project path already registered: ${relPath}`);
      }
      throw err;
    }

    // A cached snapshot describes the old repository location.
    if (updated.relPath !== existing.relPath) clearProjectSnapshot(updated.id);

    return c.json(updated);
  });

  router.post("/projects/:id/refresh", async (c) => {
    const project = findProject(db, config, c.req.param("id"));
    if (!project) return fail(c, 404, "not_found", `Project not found: ${c.req.param("id")}`);

    const repoPath = resolveProjectRepo(config, project);
    if (!repoPath) return workspaceFailure(c, config, project);

    const snapshot = await collectGitSnapshot(repoPath);
    setProjectSnapshot(project.id, snapshot);
    return c.json(snapshot);
  });

  router.get("/projects/:id/plan", async (c) => {
    const project = findProject(db, config, c.req.param("id"));
    if (!project) return fail(c, 404, "not_found", `Project not found: ${c.req.param("id")}`);

    const repoPath = resolveProjectRepo(config, project);
    if (!repoPath) return workspaceFailure(c, config, project);

    return c.json(await buildPlanState(project, repoPath, config));
  });

  router.post("/projects/:id/plan/ack-drift", async (c) => {
    const project = findProject(db, config, c.req.param("id"));
    if (!project) return fail(c, 404, "not_found", `Project not found: ${c.req.param("id")}`);

    const repoPath = resolveProjectRepo(config, project);
    if (!repoPath) return workspaceFailure(c, config, project);

    const sources = await resolvePlanSources(repoPath, {
      planFiles: project.planFiles,
      planDirs: project.planDirs,
      excludeDirs: config.defaults.plan_dir_exclude,
    });
    const results = await readPlanFiles(repoPath, sources.files);
    const hashes: Record<string, string> = {};
    for (const result of results) {
      if (result.exists && result.hash) hashes[result.path] = result.hash;
    }

    db.run("UPDATE projects SET plan_hashes_json = ? WHERE id = ?", [
      JSON.stringify(hashes),
      project.id,
    ]);

    return c.json(planStateFrom(project.id, results, hashes, project.planFiles, sources.truncated));
  });

  router.get("/projects/:id/docs", async (c) => {
    const project = findProject(db, config, c.req.param("id"));
    if (!project) return fail(c, 404, "not_found", `Project not found: ${c.req.param("id")}`);

    const repoPath = resolveProjectRepo(config, project);
    if (!repoPath) return workspaceFailure(c, config, project);

    const results = await readPlanFiles(repoPath, project.agentDocs);
    return c.json({
      projectId: project.id,
      files: results.map((result) => ({
        path: result.path,
        exists: result.exists,
        content: result.content,
        error: result.error,
      })),
    });
  });

  router.post("/discovery/scan", async (c) => {
    const root = resolveWorkspaceRoot(config);
    if (!root) return workspaceFailure(c, config, null);

    const rootStat = await stat(root).catch(() => null);
    if (!rootStat?.isDirectory()) {
      return fail(c, 404, "workspace_not_found", `Workspace directory does not exist: ${root}`);
    }

    const discovered = await scanWorkspace(root, config.defaults.scan_depth);
    const registered = new Set(
      (db.query("SELECT rel_path FROM projects").all() as { rel_path: string }[]).map(
        (row) => row.rel_path,
      ),
    );

    const repos: DiscoveredRepo[] = discovered.map((repo) => ({
      ...repo,
      alreadyRegistered: registered.has(repo.relPath),
    }));

    return c.json({ repos });
  });

  return router;
}

function fail(c: Context, status: ErrorStatus, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

type JsonBody = { ok: true; value: unknown } | { ok: false; response: Response };

async function readJsonBody(c: Context): Promise<JsonBody> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false, response: fail(c, 400, "invalid_json", "Request body must be valid JSON") };
  }
}

function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");
}

function parseStringArray(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseHashRecord(raw: string): Record<string, string> {
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

function toProject(row: ProjectRow, config: Config): Project {
  const storedDirs = row.plan_dirs_json === null ? null : parseStringArray(row.plan_dirs_json);
  return ProjectSchema.parse({
    id: row.id,
    codePrefix: row.code_prefix,
    name: row.name,
    relPath: row.rel_path,
    planFiles: parseStringArray(row.plan_files_json),
    planDirs: storedDirs ?? config.defaults.plan_dirs,
    planDirsOverride: storedDirs !== null,
    agentDocs: parseStringArray(row.agent_docs_json),
    planHashes: parseHashRecord(row.plan_hashes_json),
    nextTaskSeq: row.next_task_seq,
    active: row.active === 1,
    createdAt: row.created_at,
  });
}

function findProject(db: Database, config: Config, id: string): Project | null {
  const row = db.query("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | null;
  return row ? toProject(row, config) : null;
}

function findProjectByRelPath(
  db: Database,
  config: Config,
  relPath: string,
  excludeId?: string,
): Project | null {
  const row = db
    .query("SELECT * FROM projects WHERE lower(rel_path) = lower(?) AND id <> ?")
    .get(relPath, excludeId ?? "") as ProjectRow | null;
  return row ? toProject(row, config) : null;
}

function countTasks(db: Database, projectId: string): number {
  const row = db.query("SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?").get(projectId) as {
    count: number;
  };
  return row.count;
}

/** Keeps hashes whose path is still resolved, matching paths case-insensitively. */
function pickHashes(hashes: Record<string, string>, keepPaths: string[]): Record<string, string> {
  const wanted = new Set(keepPaths.map((file) => file.toLowerCase()));
  const kept: Record<string, string> = {};
  for (const [file, hash] of Object.entries(hashes)) {
    if (wanted.has(file.toLowerCase())) kept[file] = hash;
  }
  return kept;
}

function normalizeRelPath(relPath: string): string {
  let normalized = relPath.trim().replace(/\\/g, "/");
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function projectRelPathError(relPath: string): string | null {
  if (relPath.trim().length === 0) return "relPath is empty";
  if (path.isAbsolute(relPath)) return "relPath must be relative to the workspace root";

  const normalized = path.posix.normalize(relPath.replace(/\\/g, "/"));
  if (normalized === ".." || normalized.startsWith("../")) {
    return "relPath escapes the workspace root";
  }
  return null;
}

function relativeFilePathsError(field: string, paths: string[]): string | null {
  for (const value of paths) {
    const rejection = validateRelativePath(RELATIVE_PATH_ROOT, value);
    if (rejection) return `${field}: invalid path "${value}" (${rejection})`;
  }
  return null;
}



/** Absolute repository path, or `null` when the workspace is unset/the path escapes it. */
function resolveProjectRepo(config: Config, project: Project): string | null {
  const root = resolveWorkspaceRoot(config);
  if (!root) return null;

  const resolved = path.resolve(root, project.relPath);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

/** Message when the repo directory is missing under a configured workspace; `null` otherwise. */
async function missingProjectDirectory(config: Config, relPath: string): Promise<string | null> {
  const repoPath = resolveProjectRepo(config, { relPath } as Project);
  if (!repoPath) return null;
  try {
    const info = await stat(repoPath);
    return info.isDirectory() ? null : `Path is not a directory: ${relPath}`;
  } catch {
    return `Directory does not exist in the workspace: ${relPath}`;
  }
}

function workspaceFailure(c: Context, config: Config, project: Project | null) {
  if (!resolveWorkspaceRoot(config)) {
    return fail(c, 500, "workspace_not_configured", "workspace_root is not configured");
  }
  const relPath = project?.relPath ?? "";
  return fail(c, 400, "invalid_request", `Project relPath escapes the workspace root: ${relPath}`);
}

async function buildPlanState(
  project: Project,
  repoPath: string,
  config: Config,
): Promise<PlanState> {
  const sources = await resolvePlanSources(repoPath, {
    planFiles: project.planFiles,
    planDirs: project.planDirs,
    excludeDirs: config.defaults.plan_dir_exclude,
  });
  const results = await readPlanFiles(repoPath, sources.files);
  return planStateFrom(project.id, results, project.planHashes, project.planFiles, sources.truncated);
}

function planStateFrom(
  projectId: string,
  results: PlanFileResult[],
  storedHashes: Record<string, string>,
  planFiles: string[],
  truncated: boolean,
): PlanState {
  const origins = planFileOrigins(planFiles);
  const files = results.map((result) =>
    describePlanFile(
      result,
      storedHashes[result.path] ?? null,
      origins.get(result.path.toLowerCase()) ?? "dir",
    ),
  );
  return {
    projectId,
    files,
    drift: files.some((file) => file.driftStatus === "drift"),
    truncated,
  };
}

function describePlanFile(
  result: PlanFileResult,
  storedHash: string | null,
  origin: PlanFileOrigin,
): PlanFileState {
  const state: PlanFileState = {
    path: result.path,
    origin,
    exists: result.exists,
    hash: result.hash,
    storedHash,
    headings: result.headings,
    driftStatus: "missing",
  };

  if (result.error) return { ...state, driftStatus: "error", error: result.error };
  if (!result.exists || result.hash === null) return state;
  if (!storedHash) return { ...state, driftStatus: "untracked" };

  const { drift } = detectDrift(storedHash, result.content ?? "");
  return { ...state, driftStatus: drift ? "drift" : "clean" };
}

type ProjectConflict = "id_taken" | "rel_path_taken";

/** Maps a UNIQUE violation to the API error code for the constraint that fired. */
function uniqueProjectConflict(err: unknown): ProjectConflict | null {
  if (!(err instanceof Error) || !err.message.includes("UNIQUE constraint failed")) return null;
  const message = err.message.toLowerCase();
  if (message.includes("idx_projects_rel_path_lower") || message.includes("projects.rel_path")) {
    return "rel_path_taken";
  }
  if (message.includes("projects.id")) return "id_taken";
  return null;
}

interface ScannedRepo {
  relPath: string;
  name: string;
}

async function scanWorkspace(root: string, maxDepth: number): Promise<ScannedRepo[]> {
  const found: ScannedRepo[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;

    // A repository is a scan boundary: its nested directories are not separate projects.
    if (entries.some((entry) => entry.name === ".git")) {
      if (depth > 0) {
        found.push({ relPath: toPosix(path.relative(root, dir)), name: path.basename(dir) });
      }
      return;
    }
    if (depth >= maxDepth) return;

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => walk(path.join(dir, entry.name), depth + 1)),
    );
  };

  await walk(root, 0);
  return found.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
