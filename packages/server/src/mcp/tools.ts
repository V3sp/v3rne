import type { Database } from "bun:sqlite";
import { z } from "zod";
import {
  CommentKindSchema,
  PrioritySchema,
  StatusSchema,
  TASK_CODE_REGEX,
  type Comment,
  type Priority,
  type Status,
  type Task,
} from "@v3rne/shared";
import {
  ApiError,
  findDuplicateTaskTitles,
  formatZodError,
  insertEvent,
  mapAttachment,
  mapComment,
  mapTask,
  mapTaskEvent,
  nowIso,
  priorityOrderSql,
  requireProject,
  type ApiDeps,
  type AttachmentRow,
  type CommentRow,
  type TaskEventRow,
  type TaskRow,
} from "../api/tasks";
import { getProjectSnapshot } from "../api/projects-state";
import {
  listProjectRows,
  loadProjectPlanState,
  projectAgentDocs,
  projectSummary,
  resolveProject,
} from "./project-resolver";

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /** Keeps the result structurally compatible with the SDK's CallToolResult. */
  [key: string]: unknown;
}

const CREATE_STATUSES = ["backlog", "ready"] as const;
const MAX_BULK_TASKS = 100;

const ListProjectsInput = z.object({
  only_active: z.boolean().optional(),
});

const GetProjectContextInput = z.object({
  project_id: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
});

const ListTasksInput = z.object({
  project_id: z.string().min(1),
  status: StatusSchema.optional(),
  priority: PrioritySchema.optional(),
});

const ListDoubtsInput = z.object({
  project_id: z.string().min(1).optional(),
  only_open: z.boolean().optional(),
});

const GetTaskInput = z.object({
  task_code: z.string().regex(TASK_CODE_REGEX, "task_code must look like PREFIX-123"),
});

const GetNextTaskInput = z.object({
  project_id: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  claim: z.boolean().optional(),
  agent_name: z.string().trim().min(1).optional(),
});

const CreateTaskItemInput = z.object({
  title: z.string().trim().min(1, "title must not be empty"),
  description: z.string().default(""),
  plan_file: z.string().min(1).nullable().optional(),
  plan_section: z.string().min(1).nullable().optional(),
  priority: PrioritySchema.default("medium"),
  status: z.enum(CREATE_STATUSES).default("backlog"),
});

const CreateTasksInput = z.object({
  project_id: z.string().min(1),
  tasks: z
    .array(CreateTaskItemInput)
    .min(1, "tasks must contain at least one entry")
    .max(MAX_BULK_TASKS, `at most ${MAX_BULK_TASKS} tasks per call`),
});

const UpdateTaskInput = z.object({
  task_code: z.string().regex(TASK_CODE_REGEX, "task_code must look like PREFIX-123"),
  status: StatusSchema.optional(),
  priority: PrioritySchema.optional(),
  git_branch: z.string().min(1).nullable().optional(),
  claimed_by: z.string().min(1).nullable().optional(),
});

const AddEntryInput = z.object({
  task_code: z.string().regex(TASK_CODE_REGEX, "task_code must look like PREFIX-123"),
  kind: CommentKindSchema,
  body: z.string().min(1, "body must not be empty"),
  author_name: z.string().trim().min(1).optional(),
});

const GetAttachmentInput = z.object({
  attachment_id: z.number().int().positive(),
});

export const TOOL_INPUT_SCHEMAS = {
  list_projects: ListProjectsInput,
  get_project_context: GetProjectContextInput,
  list_tasks: ListTasksInput,
  list_doubts: ListDoubtsInput,
  get_task: GetTaskInput,
  get_next_task: GetNextTaskInput,
  create_tasks: CreateTasksInput,
  update_task: UpdateTaskInput,
  add_entry: AddEntryInput,
  get_attachment: GetAttachmentInput,
} as const;

export type ToolName = keyof typeof TOOL_INPUT_SCHEMAS;

export interface McpToolHandlers {
  listProjects: (args: unknown) => Promise<ToolResult>;
  getProjectContext: (args: unknown) => Promise<ToolResult>;
  listTasks: (args: unknown) => Promise<ToolResult>;
  listDoubts: (args: unknown) => Promise<ToolResult>;
  getTask: (args: unknown) => Promise<ToolResult>;
  getNextTask: (args: unknown) => Promise<ToolResult>;
  createTasks: (args: unknown) => Promise<ToolResult>;
  updateTask: (args: unknown) => Promise<ToolResult>;
  addEntry: (args: unknown) => Promise<ToolResult>;
  getAttachment: (args: unknown) => Promise<ToolResult>;
}

export function createToolHandlers(deps: ApiDeps): McpToolHandlers {
  const { db, config } = deps;

  const listProjects: McpToolHandlers["listProjects"] = guard(async (args) => {
    const input = ListProjectsInput.parse(args);
    const onlyActive = input.only_active ?? true;
    const rows = listProjectRows(db, onlyActive);
    const counts = statusCountsByProject(db);
    const projects = rows.map((row) => {
      const statuses = counts.get(row.id) ?? emptyStatusCounts();
      return {
        ...projectSummary(row),
        openTasks: {
          ready: statuses.ready,
          in_progress: statuses.in_progress,
          needs_input: statuses.needs_input,
          total: statuses.ready + statuses.in_progress + statuses.needs_input + statuses.backlog,
        },
      };
    });
    return textResult({ projects });
  });

  const getProjectContext: McpToolHandlers["getProjectContext"] = guard(async (args) => {
    const input = GetProjectContextInput.parse(args);
    const project = resolveProject(db, config, input.cwd, input.project_id);
    const plan = await loadProjectPlanState(config, project);
    const snapshot = getProjectSnapshot(project.id);
    const statuses = statusCounts(db, project.id);

    return textResult({
      project: {
        ...projectSummary(project),
        agentDocs: projectAgentDocs(project),
      },
      plan,
      worktrees: snapshot?.worktrees ?? [],
      git: snapshot
        ? {
            snapshotAvailable: true,
            branch: snapshot.branch,
            dirtyFiles: snapshot.dirtyFiles,
            ahead: snapshot.ahead,
            behind: snapshot.behind,
            lastCommit: snapshot.lastCommit,
          }
        : { snapshotAvailable: false },
      board: {
        statuses,
        total: Object.values(statuses).reduce((sum, value) => sum + value, 0),
      },
    });
  });

  const listTasks: McpToolHandlers["listTasks"] = guard(async (args) => {
    const input = ListTasksInput.parse(args);
    const project = requireProject(db, input.project_id);

    const where = ["t.project_id = ?"];
    const params: string[] = [project.id];
    if (input.status) {
      where.push("t.status = ?");
      params.push(input.status);
    }
    if (input.priority) {
      where.push("t.priority = ?");
      params.push(input.priority);
    }

    interface TaskWithCounts extends TaskRow {
      open_comments: number;
      open_doubts: number;
    }

    const rows = db
      .query<TaskWithCounts, string[]>(
        `SELECT t.*,
                SUM(CASE WHEN c.kind <> 'doubt' AND c.is_resolved = 0 THEN 1 ELSE 0 END) AS open_comments,
                SUM(CASE WHEN c.kind = 'doubt' AND c.is_resolved = 0 THEN 1 ELSE 0 END) AS open_doubts
           FROM tasks t
           LEFT JOIN comments c ON c.task_id = t.id
          WHERE ${where.join(" AND ")}
          GROUP BY t.id
          ORDER BY ${priorityOrderSql("t.")}, t.sort_order ASC, t.id ASC`,
      )
      .all(...params);

    return textResult({
      projectId: project.id,
      tasks: rows.map((row) => ({
        ...mapTask(row),
        openComments: row.open_comments ?? 0,
        openDoubts: row.open_doubts ?? 0,
      })),
    });
  });

  const listDoubts: McpToolHandlers["listDoubts"] = guard(async (args) => {
    const input = ListDoubtsInput.parse(args);
    const onlyOpen = input.only_open ?? true;

    if (input.project_id) requireProject(db, input.project_id);

    interface DoubtRow extends CommentRow {
      task_code: string;
      task_title: string;
      task_priority: string;
      task_status: string;
      task_project_id: string;
      project_name: string;
    }

    const where = ["c.kind = 'doubt'"];
    const params: string[] = [];
    if (onlyOpen) where.push("c.is_resolved = 0");
    if (input.project_id) {
      // An explicit project_id wins over `active` on purpose: inactive boards stay readable.
      where.push("t.project_id = ?");
      params.push(input.project_id);
    } else {
      where.push("p.active = 1");
    }

    const rows = db
      .query<DoubtRow, string[]>(
        `SELECT c.*, t.code AS task_code, t.title AS task_title, t.priority AS task_priority,
                t.status AS task_status, t.project_id AS task_project_id, p.name AS project_name
           FROM comments c
           JOIN tasks t ON t.id = c.task_id
           JOIN projects p ON p.id = t.project_id
          WHERE ${where.join(" AND ")}
          ORDER BY ${priorityOrderSql("t.")}, c.created_at ASC, c.id ASC`,
      )
      .all(...params);

    return textResult({
      doubts: rows.map((row) => ({
        comment: mapComment(row),
        task: {
          code: row.task_code,
          title: row.task_title,
          priority: row.task_priority as Priority,
          status: row.task_status as Status,
          projectId: row.task_project_id,
          projectName: row.project_name,
        },
      })),
    });
  });

  const getTask: McpToolHandlers["getTask"] = guard(async (args) => {
    const input = GetTaskInput.parse(args);
    const row = findTask(db, input.task_code);
    const project = requireProject(db, row.project_id);

    // Same message order as REST GET /tasks/:code: chronological, newest last.
    const events = db
      .query<TaskEventRow, [number]>(
        `SELECT * FROM (
           SELECT * FROM task_events
            WHERE task_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 50
         )
         ORDER BY created_at ASC, id ASC`,
      )
      .all(row.id);

    return textResult({
      task: { ...taskDetail(db, row), events: events.map(mapTaskEvent) },
      projectId: row.project_id,
      projectName: project.name,
    });
  });

  const getNextTask: McpToolHandlers["getNextTask"] = guard(async (args) => {
    const input = GetNextTaskInput.parse(args);
    const project =
      input.project_id || input.cwd
        ? resolveProject(db, config, input.cwd, input.project_id)
        : null;
    const claim = input.claim === true;
    const claimedBy = input.agent_name ?? "agent";

    if (claim && input.agent_name) {
      const existing = db
        .query<TaskRow, string[]>(
          `SELECT t.* FROM tasks t
             JOIN projects p ON p.id = t.project_id
            WHERE t.status = 'in_progress' AND t.claimed_by = ? AND p.active = 1
              ${project ? "AND t.project_id = ?" : ""}
            ORDER BY ${priorityOrderSql("t.")}, t.sort_order ASC, t.id ASC
            LIMIT 1`,
        )
        .get(...(project ? [input.agent_name, project.id] : [input.agent_name]));

      if (existing) {
        return textResult({
          task: taskDetail(db, existing),
          claimed: true,
          reused: true,
          message: `Agent "${input.agent_name}" already has ${existing.code} in progress.`,
        });
      }
    }

    const scopeSql = project ? "AND t.project_id = ?" : "";
    const scopeParams = project ? [project.id] : [];

    // A competing agent can claim the same row between SELECT and UPDATE, so retry
    // with the next candidate instead of returning an empty result.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = db
        .query<TaskRow, string[]>(
          `SELECT t.* FROM tasks t
             JOIN projects p ON p.id = t.project_id
            WHERE t.status = 'ready' AND p.active = 1 ${scopeSql}
            ORDER BY ${priorityOrderSql("t.")}, t.sort_order ASC, t.id ASC
            LIMIT 1`,
        )
        .get(...scopeParams);

      if (!candidate) {
        return textResult({
          task: null,
          claimed: false,
          message: project
            ? `No ready tasks in project "${project.id}".`
            : "No ready tasks in any project.",
        });
      }

      if (!claim) {
        return textResult({ task: taskDetail(db, candidate), claimed: false });
      }

      const claimed = claimTask(db, candidate, claimedBy);
      if (claimed) {
        return textResult({ task: taskDetail(db, claimed), claimed: true, reused: false });
      }
    }

    return errorResult("Task could not be claimed because it changed concurrently; retry.");
  });

  const createTasks: McpToolHandlers["createTasks"] = guard(async (args) => {
    const input = CreateTasksInput.parse(args);
    requireProject(db, input.project_id);

    const duplicates = findDuplicateTaskTitles(
      db,
      input.project_id,
      input.tasks.map((item) => ({ title: item.title, planSection: item.plan_section ?? null })),
    );
    if (duplicates.length > 0) {
      const titles = [...new Set(duplicates.map((duplicate) => duplicate.title))];
      return errorResult(
        `duplicate_title: rejected duplicate task title(s) in project "${input.project_id}": ${titles
          .map((title) => `"${title}"`)
          .join(", ")}`,
      );
    }

    const createBatch = db.transaction(
      (projectId: string, items: z.infer<typeof CreateTaskItemInput>[]) =>
        items.map((item) => insertTaskRow(db, projectId, item)),
    );
    const tasks = createBatch.immediate(input.project_id, input.tasks);

    return textResult({
      projectId: input.project_id,
      codes: tasks.map((task) => task.code),
      tasks,
    });
  });

  const updateTask: McpToolHandlers["updateTask"] = guard(async (args) => {
    const input = UpdateTaskInput.parse(args);
    const row = findTask(db, input.task_code);

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const events: { eventType: string; oldValue: string | null; newValue: string | null }[] = [];

    if (input.status !== undefined && input.status !== row.status) {
      sets.push("status = ?");
      params.push(input.status);
      if (input.status === "done") {
        sets.push("completed_at = ?");
        params.push(nowIso());
        events.push({ eventType: "completed", oldValue: row.status, newValue: input.status });
      } else {
        sets.push("completed_at = NULL");
        events.push({ eventType: "status_changed", oldValue: row.status, newValue: input.status });
      }
    }

    if (input.priority !== undefined && input.priority !== row.priority) {
      sets.push("priority = ?");
      params.push(input.priority);
      events.push({ eventType: "priority_changed", oldValue: row.priority, newValue: input.priority });
    }

    if (input.git_branch !== undefined && input.git_branch !== row.git_branch) {
      sets.push("git_branch = ?");
      params.push(input.git_branch);
      events.push({ eventType: "branch_changed", oldValue: row.git_branch, newValue: input.git_branch });
    }

    if (input.claimed_by !== undefined && input.claimed_by !== row.claimed_by) {
      sets.push("claimed_by = ?");
      params.push(input.claimed_by);
      events.push({
        eventType:
          input.claimed_by === null
            ? "unclaimed"
            : row.claimed_by === null
              ? "claimed"
              : "claimed_by_changed",
        oldValue: row.claimed_by,
        newValue: input.claimed_by,
      });
    }

    if (sets.length === 0) {
      return textResult({ task: mapTask(row), changed: [] });
    }

    sets.push("updated_at = ?");
    params.push(nowIso());
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
          actor: "agent",
        });
      }
    });
    applyPatch.immediate();

    return textResult({ task: mapTask(findTask(db, row.code)), changed: events.map((e) => e.eventType) });
  });

  const addEntry: McpToolHandlers["addEntry"] = guard(async (args) => {
    const input = AddEntryInput.parse(args);
    const row = findTask(db, input.task_code);
    const authorName = input.author_name ?? "agent";

    const writeEntry = db.transaction(() => {
      const now = nowIso();
      const result = db.run(
        `INSERT INTO comments (task_id, author_type, author_name, kind, body, is_resolved, resolved_at, created_at)
         VALUES (?, 'agent', ?, ?, ?, 0, NULL, ?)`,
        [row.id, authorName, input.kind, input.body, now],
      );
      const comment: Comment = {
        id: Number(result.lastInsertRowid),
        taskId: row.id,
        authorType: "agent",
        authorName,
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
          actor: authorName,
        });
      } else {
        insertEvent(db, {
          projectId: row.project_id,
          taskId: row.id,
          eventType: "entry_added",
          oldValue: null,
          newValue: input.kind,
          actor: authorName,
        });
      }

      return comment;
    });

    const comment = writeEntry.immediate();
    return textResult({ comment, task: mapTask(findTask(db, row.code)) });
  });

  const getAttachment: McpToolHandlers["getAttachment"] = guard(async (args) => {
    const input = GetAttachmentInput.parse(args);
    const row = db
      .query<AttachmentRow, [number]>("SELECT * FROM attachments WHERE id = ?")
      .get(input.attachment_id);
    if (!row) {
      throw new ApiError(404, "attachment_not_found", `Attachment ${input.attachment_id} was not found`);
    }
    if (row.size_bytes > config.mcp_attachment_max_bytes) {
      return errorResult(
        `Attachment ${row.id} is ${row.size_bytes} bytes, above the ${config.mcp_attachment_max_bytes} byte MCP limit`,
      );
    }

    const file = Bun.file(row.storage_path);
    if (!(await file.exists())) {
      throw new ApiError(404, "file_missing", `Stored file for attachment ${row.id} is missing`);
    }

    const header = `${row.filename} (${row.mime_type}, ${row.size_bytes} bytes)`;
    if (row.mime_type.startsWith("image/")) {
      const data = Buffer.from(await file.arrayBuffer()).toString("base64");
      return {
        content: [
          { type: "text", text: header },
          { type: "image", data, mimeType: row.mime_type },
        ],
      };
    }

    if (isTextMimeType(row.mime_type)) {
      const text = await file.text();
      return { content: [{ type: "text", text: `${header}\n\n${text}` }] };
    }

    return errorResult(
      `Attachment ${row.id} has unsupported MIME type "${row.mime_type}" (only image/* and text are exposed)`,
    );
  });

  return {
    listProjects,
    getProjectContext,
    listTasks,
    listDoubts,
    getTask,
    getNextTask,
    createTasks,
    updateTask,
    addEntry,
    getAttachment,
  };
}

function guard<A>(fn: (args: A) => Promise<ToolResult>): (args: unknown) => Promise<ToolResult> {
  return async (args: unknown) => {
    try {
      return await fn(args as A);
    } catch (err) {
      return errorResult(toToolErrorMessage(err));
    }
  };
}

function textResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function toToolErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.code}: ${err.message}`;
  if (err instanceof z.ZodError) return `validation_error: ${formatZodError(err)}`;
  console.error("[mcp] unexpected tool error", err);
  return "internal_error: Unexpected server error";
}

function findTask(db: Database, code: string): TaskRow {
  const row = db.query<TaskRow, [string]>("SELECT * FROM tasks WHERE code = ?").get(code);
  if (!row) throw new ApiError(404, "task_not_found", `Task "${code}" was not found`);
  return row;
}

interface NewTaskInput {
  title: string;
  description: string;
  plan_file?: string | null;
  plan_section?: string | null;
  priority: Priority;
  status: (typeof CREATE_STATUSES)[number];
}

function insertTaskRow(db: Database, projectId: string, input: NewTaskInput): Task {
  const project = requireProject(db, projectId);
  const code = `${project.code_prefix}-${project.next_task_seq}`;
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
      input.plan_file ?? null,
      input.plan_section ?? null,
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
    planFile: input.plan_file ?? null,
    planSection: input.plan_section ?? null,
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
    actor: "agent",
  });

  return task;
}

/** Runs as BEGIN IMMEDIATE so two agents cannot both win the same ready task. */
function claimTask(db: Database, candidate: TaskRow, claimedBy: string): TaskRow | null {
  const claim = db.transaction((): TaskRow | null => {
    const current = db
      .query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?")
      .get(candidate.id);
    if (!current || current.status !== "ready") return null;

    const now = nowIso();
    db.run("UPDATE tasks SET status = 'in_progress', claimed_by = ?, updated_at = ? WHERE id = ?", [
      claimedBy,
      now,
      current.id,
    ]);
    insertEvent(db, {
      projectId: current.project_id,
      taskId: current.id,
      eventType: "claimed",
      oldValue: "ready",
      newValue: "in_progress",
      actor: claimedBy,
    });

    return (
      db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(current.id) ?? null
    );
  });

  return claim.immediate();
}

function taskDetail(db: Database, row: TaskRow) {
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

  return {
    ...mapTask(row),
    comments: comments.map(mapComment),
    attachments: attachments.map(mapAttachment),
  };
}

function emptyStatusCounts(): Record<Status, number> {
  return Object.fromEntries(StatusSchema.options.map((status) => [status, 0])) as Record<Status, number>;
}

function statusCounts(db: Database, projectId: string): Record<Status, number> {
  const counts = emptyStatusCounts();
  const rows = db
    .query<{ status: string; count: number }, [string]>(
      "SELECT status, COUNT(*) AS count FROM tasks WHERE project_id = ? GROUP BY status",
    )
    .all(projectId);
  for (const row of rows) {
    if ((StatusSchema.options as readonly string[]).includes(row.status)) {
      counts[row.status as Status] = row.count;
    }
  }
  return counts;
}

function statusCountsByProject(db: Database): Map<string, Record<Status, number>> {
  const result = new Map<string, Record<Status, number>>();
  const rows = db
    .query<{ project_id: string; status: string; count: number }, []>(
      "SELECT project_id, status, COUNT(*) AS count FROM tasks GROUP BY project_id, status",
    )
    .all();
  for (const row of rows) {
    if (!(StatusSchema.options as readonly string[]).includes(row.status)) continue;
    const counts = result.get(row.project_id) ?? emptyStatusCounts();
    counts[row.status as Status] = row.count;
    result.set(row.project_id, counts);
  }
  return result;
}

function isTextMimeType(mimeType: string): boolean {
  const mime = mimeType.toLowerCase();
  return (
    mime.startsWith("text/") ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/x-ndjson",
      "application/yaml",
      "application/x-yaml",
      "application/sql",
    ].includes(mime)
  );
}
