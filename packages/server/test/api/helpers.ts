import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import type { Task } from "@v3rne/shared";
import { openDatabase, runMigrations } from "../../src/db";
import { ConfigSchema, type Config } from "../../src/config";
import { createAttachmentsRouter } from "../../src/api/attachments";
import { createStatsRouter } from "../../src/api/stats";
import { createTasksRouter } from "../../src/api/tasks";

export const API_PREFIX = "/api/v1";

export interface TestApp {
  db: Database;
  app: Hono;
  dataDir: string;
  config: Config;
  close(): void;
}

export interface TestAppOptions {
  config?: Record<string, unknown>;
  /** Reuse an existing directory instead of a fresh temp dir. */
  dataDir?: string;
}

export function createTestApp(options: TestAppOptions = {}): TestApp {
  const db = openDatabase(":memory:");
  runMigrations(db);

  const ownsDataDir = options.dataDir === undefined;
  const dataDir = options.dataDir ?? mkdtempSync(path.join(tmpdir(), "ab-api-"));
  const config = ConfigSchema.parse(options.config ?? {});
  const deps = { db, config, dataDir };

  const app = new Hono();
  app.route(API_PREFIX, createTasksRouter(deps));
  app.route(API_PREFIX, createAttachmentsRouter(deps));
  app.route(API_PREFIX, createStatsRouter(deps));

  return {
    db,
    app,
    dataDir,
    config,
    close() {
      db.close();
      if (ownsDataDir) rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface ProjectSeed {
  id: string;
  codePrefix: string;
  name: string;
  relPath: string;
  nextTaskSeq?: number;
}

export function insertProject(db: Database, seed: Partial<ProjectSeed> = {}): ProjectSeed {
  const project: ProjectSeed = {
    id: "proj-a",
    codePrefix: "PRJ",
    name: "Project A",
    relPath: "project-a",
    nextTaskSeq: 1,
    ...seed,
  };
  db.run(
    `INSERT INTO projects
       (id, code_prefix, name, rel_path, plan_files_json, agent_docs_json, plan_hashes_json,
        next_task_seq, active, created_at)
     VALUES (?, ?, ?, ?, '[]', '[]', '{}', ?, 1, ?)`,
    [project.id, project.codePrefix, project.name, project.relPath, project.nextTaskSeq ?? 1, nowIso()],
  );
  return project;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function postJson(app: Hono, url: string, body: unknown) {
  return app.request(`${API_PREFIX}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function patchJson(app: Hono, url: string, body: unknown) {
  return app.request(`${API_PREFIX}${url}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getJson(app: Hono, url: string) {
  return app.request(`${API_PREFIX}${url}`);
}

export function deleteJson(app: Hono, url: string) {
  return app.request(`${API_PREFIX}${url}`, { method: "DELETE" });
}

export async function createTask(
  app: Hono,
  body: Record<string, unknown> = {},
  projectId = "proj-a",
): Promise<Task> {
  const res = await postJson(app, `/projects/${projectId}/tasks`, { title: "Task", ...body });
  if (res.status !== 201) {
    throw new Error(`createTask failed with ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as Task;
}

export interface InsertEventInput {
  projectId: string;
  taskId: number;
  eventType: string;
  oldValue?: string | null;
  newValue?: string | null;
  actor?: string;
  createdAt?: string;
}

/** Writes a `task_events` row directly, for tests that need historical timestamps. */
export function insertEvent(db: Database, input: InsertEventInput): void {
  db.run(
    `INSERT INTO task_events (project_id, task_id, event_type, old_value, new_value, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.projectId,
      input.taskId,
      input.eventType,
      input.oldValue ?? null,
      input.newValue ?? null,
      input.actor ?? "test",
      input.createdAt ?? nowIso(),
    ],
  );
}

export function countRows(db: Database, table: "tasks" | "comments" | "attachments" | "task_events"): number {
  const row = db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return row?.count ?? 0;
}
