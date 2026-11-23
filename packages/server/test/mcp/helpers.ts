import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import type { Priority, Status } from "@v3rne/shared";
import { openDatabase, runMigrations } from "../../src/db";
import { ConfigSchema, type Config } from "../../src/config";
import { createToolHandlers, type McpToolHandlers, type ToolResult } from "../../src/mcp";

export interface McpTestContext {
  db: Database;
  config: Config;
  dataDir: string;
  /** Root the configured projects live under; doubles as `workspace_root`. */
  workspaceDir: string;
  handlers: McpToolHandlers;
  close(): void;
}

export interface McpTestOptions {
  config?: Record<string, unknown>;
}

export function createMcpTestContext(options: McpTestOptions = {}): McpTestContext {
  const db = openDatabase(":memory:");
  runMigrations(db);

  const dataDir = mkdtempSync(path.join(tmpdir(), "ab-mcp-"));
  const workspaceDir = path.join(dataDir, "workspace");
  const config = ConfigSchema.parse({
    workspace_root: workspaceDir,
    ...options.config,
  });

  return {
    db,
    config,
    dataDir,
    workspaceDir,
    handlers: createToolHandlers({ db, config, dataDir }),
    close() {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface ProjectSeed {
  id?: string;
  codePrefix?: string;
  name?: string;
  relPath?: string;
  planFiles?: string[];
  /** `null` keeps the config default (stored as SQL NULL). */
  planDirs?: string[] | null;
  planHashes?: Record<string, string>;
  nextTaskSeq?: number;
  active?: boolean;
}

export function seedProject(db: Database, seed: ProjectSeed = {}): Required<ProjectSeed> {
  const project: Required<ProjectSeed> = {
    id: "proj-a",
    codePrefix: "PRJ",
    name: "Project A",
    relPath: "project-a",
    planFiles: ["plan.md"],
    planDirs: null,
    planHashes: {},
    nextTaskSeq: 1,
    active: true,
    ...seed,
  };

  db.run(
    `INSERT INTO projects
       (id, code_prefix, name, rel_path, plan_files_json, plan_dirs_json, agent_docs_json,
        plan_hashes_json, next_task_seq, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
    [
      project.id,
      project.codePrefix,
      project.name,
      project.relPath,
      JSON.stringify(project.planFiles),
      project.planDirs === null ? null : JSON.stringify(project.planDirs),
      JSON.stringify(project.planHashes),
      project.nextTaskSeq,
      project.active ? 1 : 0,
      new Date().toISOString(),
    ],
  );

  return project;
}

export interface TaskSeed {
  projectId?: string;
  code: string;
  title?: string;
  description?: string;
  planSection?: string | null;
  status?: Status;
  priority?: Priority;
  sortOrder?: number;
  claimedBy?: string | null;
}

export function seedTask(db: Database, seed: TaskSeed): { id: number; code: string; status: Status } {
  const now = new Date().toISOString();
  const result = db.run(
    `INSERT INTO tasks
       (project_id, code, title, description, plan_file, plan_section, status, priority,
        sort_order, claimed_by, git_branch, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    [
      seed.projectId ?? "proj-a",
      seed.code,
      seed.title ?? `Task ${seed.code}`,
      seed.description ?? "",
      seed.planSection ?? null,
      seed.status ?? "ready",
      seed.priority ?? "medium",
      seed.sortOrder ?? 0,
      seed.claimedBy ?? null,
      now,
      now,
    ],
  );

  return { id: Number(result.lastInsertRowid), code: seed.code, status: seed.status ?? "ready" };
}

export function seedComment(
  db: Database,
  taskId: number,
  kind: "comment" | "doubt" | "progress" | "decision" = "comment",
): number {
  const result = db.run(
    `INSERT INTO comments (task_id, author_type, author_name, kind, body, is_resolved, resolved_at, created_at)
     VALUES (?, 'agent', 'seeder', ?, 'seeded entry', 0, NULL, ?)`,
    [taskId, kind, new Date().toISOString()],
  );
  return Number(result.lastInsertRowid);
}

/** Parses the JSON payload of a single-text-block tool result. */
export function textPayload<T = unknown>(result: ToolResult): T {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("Expected a text content block");
  return JSON.parse(block.text) as T;
}

export function imageBlocks(result: ToolResult) {
  return result.content.filter(
    (block): block is { type: "image"; data: string; mimeType: string } => block.type === "image",
  );
}
