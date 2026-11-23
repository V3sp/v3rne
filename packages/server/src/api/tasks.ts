import type { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  AuthorTypeSchema,
  CommentKindSchema,
  PrioritySchema,
  StatusSchema,
  TASK_CODE_REGEX,
  type Attachment,
  type Comment,
  type Priority,
  type Status,
  type Task,
  type TaskEvent,
} from "@v3rne/shared";
import type { Config } from "../config";

export interface ApiDeps {
  db: Database;
  config: Config;
  /** Root of the portal data volume. Defaults to `DATA_DIR` or `./data`. */
  dataDir?: string;
}

export type ErrorStatus = 400 | 404 | 409 | 413 | 500;

export class ApiError extends Error {
  constructor(
    readonly status: ErrorStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonError(c: Context, status: ErrorStatus, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function toErrorResponse(c: Context, err: unknown) {
  if (err instanceof ApiError) return jsonError(c, err.status, err.code, err.message);
  console.error("[api] unexpected error", err);
  return jsonError(c, 500, "internal_error", "Unexpected server error");
}

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export interface ProjectRow {
  id: string;
  code_prefix: string;
  name: string;
  next_task_seq: number;
}

export interface TaskRow {
  id: number;
  project_id: string;
  code: string;
  title: string;
  description: string;
  plan_file: string | null;
  plan_section: string | null;
  status: string;
  priority: string;
  sort_order: number;
  claimed_by: string | null;
  git_branch: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CommentRow {
  id: number;
  task_id: number;
  author_type: string;
  author_name: string;
  kind: string;
  body: string;
  is_resolved: number;
  resolved_at: string | null;
  created_at: string;
}

export interface AttachmentRow {
  id: number;
  task_id: number;
  comment_id: number | null;
  filename: string;
  mime_type: string;
  storage_path: string;
  size_bytes: number;
  created_at: string;
}

export interface TaskEventRow {
  id: number;
  project_id: string;
  task_id: number;
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  actor: string;
  created_at: string;
}

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    title: row.title,
    description: row.description,
    planFile: row.plan_file,
    planSection: row.plan_section,
    status: row.status as Status,
    priority: row.priority as Priority,
    sortOrder: row.sort_order,
    claimedBy: row.claimed_by,
    gitBranch: row.git_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function mapComment(row: CommentRow): Comment {
  return {
    id: row.id,
    taskId: row.task_id,
    authorType: row.author_type as Comment["authorType"],
    authorName: row.author_name,
    kind: row.kind as Comment["kind"],
    body: row.body,
    isResolved: row.is_resolved === 1,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

export function mapAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    taskId: row.task_id,
    commentId: row.comment_id,
    filename: row.filename,
    mimeType: row.mime_type,
    storagePath: row.storage_path,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export function mapTaskEvent(row: TaskEventRow): TaskEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    eventType: row.event_type,
    oldValue: row.old_value,
    newValue: row.new_value,
    actor: row.actor,
    createdAt: row.created_at,
  };
}

/** SQL sort key: urgent first, low last. `alias` may be `"t."` for joined queries. */
export function priorityOrderSql(alias = ""): string {
  return `CASE ${alias}priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;
}

export function insertEvent(
  db: Database,
  event: {
    projectId: string;
    taskId: number;
    eventType: string;
    oldValue: string | null;
    newValue: string | null;
    actor: string;
  },
): void {
  db.run(
    `INSERT INTO task_events (project_id, task_id, event_type, old_value, new_value, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      event.projectId,
      event.taskId,
      event.eventType,
      event.oldValue,
      event.newValue,
      event.actor,
      nowIso(),
    ],
  );
}

export function findTaskByCode(db: Database, code: string): TaskRow | null {
  const row = db.query<TaskRow, [string]>("SELECT * FROM tasks WHERE code = ?").get(code);
  return row ?? null;
}

export function requireProject(db: Database, projectId: string): ProjectRow {
  const row = db
    .query<ProjectRow, [string]>("SELECT id, code_prefix, name, next_task_seq FROM projects WHERE id = ?")
    .get(projectId);
  if (!row) throw new ApiError(404, "project_not_found", `Project "${projectId}" was not found`);
  return row;
}

const CREATE_STATUSES = ["backlog", "ready"] as const;

const CreateTaskSchema = z.object({
  title: z.string().trim().min(1, "title must not be empty"),
  description: z.string().default(""),
  planFile: z.string().min(1).nullable().optional(),
  planSection: z.string().min(1).nullable().optional(),
  priority: PrioritySchema.default("medium"),
  status: z.enum(CREATE_STATUSES).default("backlog"),
  actor: z.string().min(1).default("human"),
});

type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

const ListTasksQuerySchema = z.object({
  status: StatusSchema.optional(),
  priority: PrioritySchema.optional(),
  planSection: z.string().min(1).optional(),
});

const MAX_BULK_TASKS = 100;

const PatchTaskSchema = z.object({
  status: StatusSchema.optional(),
  priority: PrioritySchema.optional(),
  sortOrder: z.number().int().optional(),
  planFile: z.string().min(1).nullable().optional(),
  planSection: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  claimedBy: z.string().min(1).nullable().optional(),
  gitBranch: z.string().min(1).nullable().optional(),
  actor: z.string().min(1).optional(),
});

const CreateCommentSchema = z.object({
  authorType: AuthorTypeSchema,
  authorName: z.string().trim().min(1),
  kind: CommentKindSchema.default("comment"),
  body: z.string().min(1, "body must not be empty"),
});

const ResolveDoubtSchema = z.object({
  reply: z.string().trim().min(1, "reply must not be empty"),
  authorType: AuthorTypeSchema.default("human"),
  authorName: z.string().trim().min(1).default("Ty"),
});

export interface TaskTitleInput {
  title: string;
  planSection?: string | null;
}

export interface DuplicateTaskTitle {
  index: number;
  title: string;
  planSection: string | null;
}

/**
 * Duplicate titles are compared trimmed and case-insensitively, scoped to one
 * project and one plan section, against existing rows and earlier batch items.
 */
export function findDuplicateTaskTitles(
  db: Database,
  projectId: string,
  inputs: TaskTitleInput[],
): DuplicateTaskTitle[] {
  const existing = db
    .query<{ title: string }, [string]>("SELECT title FROM tasks WHERE project_id = ?")
    .all(projectId);
  const seen = new Set(existing.map((row) => titleKey(row.title)));

  const duplicates: DuplicateTaskTitle[] = [];
  for (const [index, input] of inputs.entries()) {
    const planSection = input.planSection ?? null;
    const key = titleKey(input.title);
    if (seen.has(key)) {
      duplicates.push({ index, title: input.title.trim(), planSection });
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

/** Duplicates are checked across the whole project, regardless of plan section. */
function titleKey(title: string): string {
  return title.trim().toLowerCase();
}

function insertTaskRow(db: Database, projectId: string, input: CreateTaskInput): Task {
  const project = requireProject(db, projectId);
  const seq = project.next_task_seq;
  const code = `${project.code_prefix}-${seq}`;
  if (!TASK_CODE_REGEX.test(code)) {
    throw new ApiError(
      400,
      "invalid_task_code",
      `Project prefix "${project.code_prefix}" produces invalid task code "${code}"`,
    );
  }

  db.run("UPDATE projects SET next_task_seq = next_task_seq + 1 WHERE id = ?", [projectId]);

  const now = nowIso();
  const result = db.run(
    `INSERT INTO tasks
       (project_id, code, title, description, plan_file, plan_section, status, priority,
        sort_order, claimed_by, git_branch, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, NULL)`,
    [
      projectId,
      code,
      input.title,
      input.description,
      input.planFile ?? null,
      input.planSection ?? null,
      input.status,
      input.priority,
      now,
      now,
    ],
  );

  const task: Task = {
    id: Number(result.lastInsertRowid),
    projectId,
    code,
    title: input.title,
    description: input.description,
    planFile: input.planFile ?? null,
    planSection: input.planSection ?? null,
    status: input.status,
    priority: input.priority,
    sortOrder: 0,
    claimedBy: null,
    gitBranch: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  insertEvent(db, {
    projectId,
    taskId: task.id,
    eventType: "created",
    oldValue: null,
    newValue: task.status,
    actor: input.actor,
  });

  return task;
}

export function createTasksRouter(deps: ApiDeps): Hono {
  const { db } = deps;
  const app = new Hono();

  app.get("/projects/:id/tasks", (c) => {
    try {
      const projectId = c.req.param("id");
      requireProject(db, projectId);

      const parsed = ListTasksQuerySchema.safeParse(c.req.query());
      if (!parsed.success) {
        return jsonError(c, 400, "validation_error", formatZodError(parsed.error));
      }

      const where = ["project_id = ?"];
      const params: string[] = [projectId];
      if (parsed.data.status) {
        where.push("status = ?");
        params.push(parsed.data.status);
      }
      if (parsed.data.priority) {
        where.push("priority = ?");
        params.push(parsed.data.priority);
      }
      if (parsed.data.planSection) {
        where.push("plan_section = ?");
        params.push(parsed.data.planSection);
      }

      const rows = db
        .query<TaskRow, string[]>(
          `SELECT * FROM tasks WHERE ${where.join(" AND ")}
           ORDER BY ${priorityOrderSql()}, sort_order ASC, id ASC`,
        )
        .all(...params);

      return c.json({ tasks: rows.map(mapTask) });
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  app.post("/projects/:id/tasks", async (c) => {
    try {
      const projectId = c.req.param("id");
      const body = await readJson(c);
      const parsed = CreateTaskSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(c, 400, "validation_error", formatZodError(parsed.error));
      }

      const duplicates = findDuplicateTaskTitles(db, projectId, [parsed.data]);
      if (duplicates.length > 0) {
        return c.json(
          {
            error: {
              code: "duplicate_title",
              message: `duplicate title "${duplicates[0]!.title}" in this project`,
            },
          },
          409,
        );
      }

      const create = db.transaction((input: CreateTaskInput) => insertTaskRow(db, projectId, input));
      const task = create(parsed.data);
      return c.json(task, 201);
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  app.post("/projects/:id/tasks/bulk", async (c) => {
    try {
      const projectId = c.req.param("id");
      const body = await readJson(c);

      if (!Array.isArray(body)) {
        return jsonError(c, 400, "validation_error", "body must be an array of tasks");
      }
      if (body.length === 0) {
        return jsonError(c, 400, "validation_error", "body must contain at least one task");
      }
      if (body.length > MAX_BULK_TASKS) {
        return jsonError(c, 400, "validation_error", `at most ${MAX_BULK_TASKS} tasks per request`);
      }

      const inputs: CreateTaskInput[] = [];
      for (const [index, item] of body.entries()) {
        const parsed = CreateTaskSchema.safeParse(item);
        if (!parsed.success) {
          const detail = parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
            .join("; ");
          return jsonError(c, 400, "validation_error", `tasks[${index}]: ${detail}`);
        }
        inputs.push(parsed.data);
      }

      const duplicates = findDuplicateTaskTitles(db, projectId, inputs);
      if (duplicates.length > 0) {
        const duplicate = duplicates[0]!;
        return c.json(
          {
            error: {
              code: "duplicate_title",
              message: `tasks[${duplicate.index}]: duplicate title "${duplicate.title}" in this project`,
              index: duplicate.index,
            },
            index: duplicate.index,
          },
          409,
        );
      }

      const createBatch = db.transaction((batch: CreateTaskInput[]) =>
        batch.map((input) => insertTaskRow(db, projectId, input)),
      );
      const tasks = createBatch(inputs);
      return c.json({ tasks }, 201);
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  app.get("/tasks/:code", (c) => {
    try {
      const row = findTaskByCode(db, c.req.param("code"));
      if (!row) throw new ApiError(404, "task_not_found", `Task "${c.req.param("code")}" was not found`);

      const comments = db
        .query<CommentRow, [number]>(
          "SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC, id ASC",
        )
        .all(row.id);
      const attachments = db
        .query<AttachmentRow, [number]>(
          "SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at ASC, id ASC",
        )
        .all(row.id);
      const events = db
        .query<TaskEventRow, [number]>(
          "SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC, id ASC",
        )
        .all(row.id);

      return c.json({
        ...mapTask(row),
        comments: comments.map(mapComment),
        attachments: attachments.map(mapAttachment),
        events: events.map(mapTaskEvent),
      });
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  app.patch("/tasks/:code", async (c) => {
    try {
      const row = findTaskByCode(db, c.req.param("code"));
      if (!row) throw new ApiError(404, "task_not_found", `Task "${c.req.param("code")}" was not found`);

      const body = await readJson(c);
      const parsed = PatchTaskSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(c, 400, "validation_error", formatZodError(parsed.error));
      }
      const patch = parsed.data;
      const actor = patch.actor ?? "human";

      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      const events: { eventType: string; oldValue: string | null; newValue: string | null }[] = [];

      // Manual transitions are allowed on purpose (no state machine here), but
      // `completed_at` follows `done` and `completed` feeds the velocity charts.
      if (patch.status !== undefined && patch.status !== row.status) {
        sets.push("status = ?");
        params.push(patch.status);

        if (patch.status === "done") {
          sets.push("completed_at = ?");
          params.push(nowIso());
          events.push({ eventType: "completed", oldValue: row.status, newValue: patch.status });
        } else {
          sets.push("completed_at = NULL");
          events.push({ eventType: "status_changed", oldValue: row.status, newValue: patch.status });
        }
      }

      if (patch.priority !== undefined && patch.priority !== row.priority) {
        sets.push("priority = ?");
        params.push(patch.priority);
        events.push({
          eventType: "priority_changed",
          oldValue: row.priority,
          newValue: patch.priority,
        });
      }

      for (const field of SIMPLE_PATCH_FIELDS) {
        const value = patch[field.key];
        if (value === undefined || value === row[field.column]) continue;
        sets.push(`${field.column} = ?`);
        params.push(value);
      }

      if (sets.length === 0) return c.json(mapTask(row));

      const updatedAt = nowIso();
      sets.push("updated_at = ?");
      params.push(updatedAt);
      params.push(row.id);

      const applyPatch = db.transaction(() => {
        db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params);
        for (const event of events) {
          insertEvent(db, {
            projectId: row.project_id,
            taskId: row.id,
            eventType: event.eventType,
            oldValue: event.oldValue,
            newValue: event.newValue,
            actor,
          });
        }
      });
      applyPatch();

      const updated = findTaskByCode(db, row.code);
      if (!updated) throw new ApiError(404, "task_not_found", `Task "${row.code}" was not found`);
      return c.json(mapTask(updated));
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  app.delete("/tasks/:code", async (c) => {
    try {
      const row = findTaskByCode(db, c.req.param("code"));
      if (!row) throw new ApiError(404, "task_not_found", `Task "${c.req.param("code")}" was not found`);

      // Attachment rows go away with the task via ON DELETE CASCADE; the files do not.
      const attachments = db
        .query<{ storage_path: string }, [number]>(
          "SELECT storage_path FROM attachments WHERE task_id = ?",
        )
        .all(row.id);
      db.run("DELETE FROM tasks WHERE id = ?", [row.id]);

      await Promise.all(
        attachments.map(async (attachment) => {
          try {
            await unlink(attachment.storage_path);
          } catch (err) {
            console.warn(`[api] failed to delete attachment file ${attachment.storage_path}`, err);
          }
        }),
      );

      return c.body(null, 204);
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  app.post("/tasks/:code/comments", async (c) => {
    try {
      const row = findTaskByCode(db, c.req.param("code"));
      if (!row) throw new ApiError(404, "task_not_found", `Task "${c.req.param("code")}" was not found`);

      const body = await readJson(c);
      const parsed = CreateCommentSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(c, 400, "validation_error", formatZodError(parsed.error));
      }
      const input = parsed.data;

      const addComment = db.transaction(() => {
        const now = nowIso();
        const result = db.run(
          `INSERT INTO comments (task_id, author_type, author_name, kind, body, is_resolved, resolved_at, created_at)
           VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`,
          [row.id, input.authorType, input.authorName, input.kind, input.body, now],
        );
        const comment: Comment = {
          id: Number(result.lastInsertRowid),
          taskId: row.id,
          authorType: input.authorType,
          authorName: input.authorName,
          kind: input.kind,
          body: input.body,
          isResolved: false,
          resolvedAt: null,
          createdAt: now,
        };

        if (input.kind === "doubt" && row.status !== "done" && row.status !== "cancelled") {
          db.run("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", [
            "needs_input",
            now,
            row.id,
          ]);
          insertEvent(db, {
            projectId: row.project_id,
            taskId: row.id,
            eventType: "doubt_opened",
            oldValue: row.status,
            newValue: "needs_input",
            actor: input.authorName,
          });
        }

        return comment;
      });

      return c.json(addComment(), 201);
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  app.post("/comments/:id/resolve", async (c) => {
    try {
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id) || id <= 0) {
        return jsonError(c, 400, "validation_error", "comment id must be a positive integer");
      }

      const doubt = db.query<CommentRow, [number]>("SELECT * FROM comments WHERE id = ?").get(id);
      if (!doubt) throw new ApiError(404, "comment_not_found", `Comment ${id} was not found`);

      const body = await readJson(c);
      const parsed = ResolveDoubtSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(c, 400, "validation_error", formatZodError(parsed.error));
      }
      const input = parsed.data;

      if (doubt.kind !== "doubt") {
        throw new ApiError(409, "not_a_doubt", "Only comments of kind 'doubt' can be resolved");
      }
      if (doubt.is_resolved === 1) {
        throw new ApiError(409, "already_resolved", `Doubt ${id} is already resolved`);
      }

      const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(doubt.task_id);
      if (!task) throw new ApiError(404, "task_not_found", `Task for doubt ${id} was not found`);

      const resolve = db.transaction(() => {
        const now = nowIso();
        db.run("UPDATE comments SET is_resolved = 1, resolved_at = ? WHERE id = ?", [now, doubt.id]);

        const result = db.run(
          `INSERT INTO comments (task_id, author_type, author_name, kind, body, is_resolved, resolved_at, created_at)
           VALUES (?, ?, ?, 'decision', ?, 1, ?, ?)`,
          [task.id, input.authorType, input.authorName, input.reply, now, now],
        );
        const decision: Comment = {
          id: Number(result.lastInsertRowid),
          taskId: task.id,
          authorType: input.authorType,
          authorName: input.authorName,
          kind: "decision",
          body: input.reply,
          isResolved: true,
          resolvedAt: now,
          createdAt: now,
        };

        insertEvent(db, {
          projectId: task.project_id,
          taskId: task.id,
          eventType: "doubt_resolved",
          oldValue: `doubt:${doubt.id}`,
          newValue: `decision:${decision.id}`,
          actor: input.authorName,
        });

        const remaining = db
          .query<{ count: number }, [number]>(
            "SELECT COUNT(*) AS count FROM comments WHERE task_id = ? AND kind = 'doubt' AND is_resolved = 0",
          )
          .get(task.id);
        const openDoubts = remaining?.count ?? 0;

        let statusChanged = false;
        if (task.status === "needs_input" && openDoubts === 0) {
          db.run("UPDATE tasks SET status = 'ready', updated_at = ? WHERE id = ?", [now, task.id]);
          insertEvent(db, {
            projectId: task.project_id,
            taskId: task.id,
            eventType: "status_changed",
            oldValue: "needs_input",
            newValue: "ready",
            actor: input.authorName,
          });
          statusChanged = true;
        }

        const resolvedDoubt: Comment = { ...mapComment(doubt), isResolved: true, resolvedAt: now };
        const updatedTask =
          db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(task.id) ?? task;

        return {
          comment: decision,
          doubt: resolvedDoubt,
          task: mapTask(updatedTask),
          statusChanged,
          openDoubts,
        };
      });

      return c.json(resolve());
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  app.get("/doubts", (c) => {
    try {
      const rows = db
        .query<DoubtRow, []>(
          `SELECT c.*, t.code AS task_code, t.title AS task_title, t.priority AS task_priority,
                  t.project_id AS task_project_id, p.name AS project_name
           FROM comments c
           JOIN tasks t ON t.id = c.task_id
           JOIN projects p ON p.id = t.project_id
           WHERE c.kind = 'doubt' AND c.is_resolved = 0
           ORDER BY ${priorityOrderSql("t.")}, c.created_at ASC, c.id ASC`,
        )
        .all();

      return c.json({
        doubts: rows.map((row) => ({
          comment: mapComment(row),
          task: {
            code: row.task_code,
            title: row.task_title,
            priority: row.task_priority as Priority,
            projectId: row.task_project_id,
            projectName: row.project_name,
          },
        })),
      });
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  return app;
}

interface DoubtRow extends CommentRow {
  task_code: string;
  task_title: string;
  task_priority: string;
  task_project_id: string;
  project_name: string;
}

type PatchTaskShape = z.infer<typeof PatchTaskSchema>;

type PatchableKey = "sortOrder" | "planFile" | "planSection" | "title" | "description" | "claimedBy" | "gitBranch";
type PatchableColumn = "sort_order" | "plan_file" | "plan_section" | "title" | "description" | "claimed_by" | "git_branch";

/** Fields written as-is; status, priority and completed_at have their own logic. */
const SIMPLE_PATCH_FIELDS: { key: PatchableKey; column: PatchableColumn }[] = [
  { key: "sortOrder", column: "sort_order" },
  { key: "planFile", column: "plan_file" },
  { key: "planSection", column: "plan_section" },
  { key: "title", column: "title" },
  { key: "description", column: "description" },
  { key: "claimedBy", column: "claimed_by" },
  { key: "gitBranch", column: "git_branch" },
];

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }
}
