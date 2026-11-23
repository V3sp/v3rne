import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import path from "node:path";
import type { Database } from "bun:sqlite";
import {
  type McpToolHandlers,
  type ToolResult,
} from "../../src/mcp";
import {
  createMcpTestContext,
  imageBlocks,
  seedComment,
  seedProject,
  seedTask,
  textPayload,
  type McpTestContext,
} from "./helpers";

let ctx: McpTestContext;
let db: Database;
let handlers: McpToolHandlers;

beforeEach(() => {
  ctx = createMcpTestContext();
  db = ctx.db;
  handlers = ctx.handlers;
});

afterEach(() => {
  ctx.close();
});

interface ListedProject {
  id: string;
  codePrefix: string;
  name: string;
  relPath: string;
  active: boolean;
  openTasks: { ready: number; in_progress: number; needs_input: number; total: number };
}

interface ListedTask {
  code: string;
  status: string;
  priority: string;
  openComments: number;
  openDoubts: number;
}

interface TaskPayload {
  task: (ListedTask & { claimedBy: string | null; comments: unknown[]; attachments: unknown[] }) | null;
  claimed: boolean;
  reused?: boolean;
  message?: string;
}

interface TaskDetailPayload {
  task: {
    code: string;
    comments: { kind: string; body: string }[];
    attachments: unknown[];
    events: { eventType: string; oldValue: string | null; newValue: string | null }[];
  };
  projectId: string;
  projectName: string;
}

interface DoubtsPayload {
  doubts: {
    comment: { kind: string; body: string; isResolved: boolean };
    task: { code: string; title: string; priority: string; status: string; projectId: string; projectName: string };
  }[];
}

function seedEvent(
  database: Database,
  projectId: string,
  taskId: number,
  eventType: string,
  createdAt: string,
): void {
  database.run(
    `INSERT INTO task_events (project_id, task_id, event_type, old_value, new_value, actor, created_at)
     VALUES (?, ?, ?, NULL, NULL, 'seeder', ?)`,
    [projectId, taskId, eventType, createdAt],
  );
}

function seedDoubt(
  database: Database,
  taskId: number,
  options: { body: string; createdAt: string; resolved?: boolean },
): void {
  database.run(
    `INSERT INTO comments (task_id, author_type, author_name, kind, body, is_resolved, resolved_at, created_at)
     VALUES (?, 'agent', 'seeder', 'doubt', ?, ?, ?, ?)`,
    [
      taskId,
      options.body,
      options.resolved ? 1 : 0,
      options.resolved ? options.createdAt : null,
      options.createdAt,
    ],
  );
}

describe("list_projects", () => {
  it("returns active projects with open task counts", async () => {
    seedProject(db, { id: "proj-a", name: "Project A", relPath: "project-a" });
    seedProject(db, {
      id: "proj-b",
      codePrefix: "PRB",
      name: "Project B",
      relPath: "project-b",
      active: false,
    });

    seedTask(db, { code: "PRJ-1", status: "ready" });
    seedTask(db, { code: "PRJ-2", status: "in_progress" });
    seedTask(db, { code: "PRJ-3", status: "needs_input" });
    seedTask(db, { code: "PRJ-4", status: "done" });

    const payload = textPayload<{ projects: ListedProject[] }>(
      await handlers.listProjects({}),
    );

    expect(payload.projects).toHaveLength(1);
    expect(payload.projects[0]).toMatchObject({
      id: "proj-a",
      codePrefix: "PRJ",
      name: "Project A",
      relPath: "project-a",
      active: true,
    });
    expect(payload.projects[0]?.openTasks).toEqual({
      ready: 1,
      in_progress: 1,
      needs_input: 1,
      total: 3,
    });

    const all = textPayload<{ projects: ListedProject[] }>(
      await handlers.listProjects({ only_active: false }),
    );
    expect(all.projects.map((project) => project.id).sort()).toEqual(["proj-a", "proj-b"]);
  });
});

describe("list_tasks", () => {
  it("returns tasks with priorities and open comment/doubt counts", async () => {
    const project = seedProject(db);
    const task = seedTask(db, { code: "PRJ-1", priority: "high" });
    seedTask(db, { code: "PRJ-2", priority: "low" });
    seedComment(db, task.id, "comment");
    seedComment(db, task.id, "doubt");

    const payload = textPayload<{ tasks: ListedTask[] }>(
      await handlers.listTasks({ project_id: project.id }),
    );

    expect(payload.tasks.map((item) => item.code)).toEqual(["PRJ-1", "PRJ-2"]);
    expect(payload.tasks[0]).toMatchObject({
      code: "PRJ-1",
      priority: "high",
      openComments: 1,
      openDoubts: 1,
    });
  });
});

describe("get_next_task", () => {
  it("returns the highest-priority ready task without claiming it", async () => {
    const project = seedProject(db);
    seedTask(db, { code: "PRJ-1", priority: "low" });
    seedTask(db, { code: "PRJ-2", priority: "urgent", sortOrder: 5 });
    seedTask(db, { code: "PRJ-3", priority: "high" });
    seedTask(db, { code: "PRJ-4", priority: "urgent", sortOrder: 1, status: "in_progress" });

    const payload = textPayload<TaskPayload>(
      await handlers.getNextTask({ project_id: project.id }),
    );

    expect(payload.task?.code).toBe("PRJ-2");
    expect(payload.claimed).toBe(false);

    const row = db
      .query<{ status: string; claimed_by: string | null }, [string]>(
        "SELECT status, claimed_by FROM tasks WHERE code = ?",
      )
      .get("PRJ-2");
    expect(row).toEqual({ status: "ready", claimed_by: null });
  });

  it("skips tasks from inactive projects when no project is given", async () => {
    seedProject(db, { id: "proj-a", active: true });
    seedProject(db, {
      id: "proj-b",
      codePrefix: "PRB",
      name: "Project B",
      relPath: "project-b",
      active: false,
    });
    seedTask(db, { projectId: "proj-b", code: "PRB-1", priority: "urgent" });
    seedTask(db, { projectId: "proj-a", code: "PRJ-1", priority: "low" });

    const payload = textPayload<TaskPayload>(await handlers.getNextTask({}));
    expect(payload.task?.code).toBe("PRJ-1");
  });

  it("claims a ready task when claim=true", async () => {
    const project = seedProject(db);
    seedTask(db, { code: "PRJ-1", priority: "high" });

    const payload = textPayload<TaskPayload>(
      await handlers.getNextTask({
        project_id: project.id,
        claim: true,
        agent_name: "agent-alpha",
      }),
    );

    expect(payload.claimed).toBe(true);
    expect(payload.task?.code).toBe("PRJ-1");
    expect(payload.task?.status).toBe("in_progress");
    expect(payload.task?.claimedBy).toBe("agent-alpha");

    const row = db
      .query<{ status: string; claimed_by: string | null }, [string]>(
        "SELECT status, claimed_by FROM tasks WHERE code = ?",
      )
      .get("PRJ-1");
    expect(row).toEqual({ status: "in_progress", claimed_by: "agent-alpha" });

    const event = db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) AS count FROM task_events WHERE event_type = 'claimed' AND actor = ?",
      )
      .get("agent-alpha");
    expect(event?.count).toBe(1);
  });

  it("is idempotent: the same agent gets its in-progress task back instead of a new one", async () => {
    const project = seedProject(db);
    seedTask(db, { code: "PRJ-1", priority: "high" });

    const first = textPayload<TaskPayload>(
      await handlers.getNextTask({
        project_id: project.id,
        claim: true,
        agent_name: "agent-alpha",
      }),
    );
    expect(first.task?.code).toBe("PRJ-1");

    seedTask(db, { code: "PRJ-2", priority: "urgent" });

    const second = textPayload<TaskPayload>(
      await handlers.getNextTask({
        project_id: project.id,
        claim: true,
        agent_name: "agent-alpha",
      }),
    );

    expect(second.task?.code).toBe("PRJ-1");
    expect(second.reused).toBe(true);

    const other = db
      .query<{ status: string; claimed_by: string | null }, [string]>(
        "SELECT status, claimed_by FROM tasks WHERE code = ?",
      )
      .get("PRJ-2");
    expect(other).toEqual({ status: "ready", claimed_by: null });
  });
});

describe("get_task", () => {
  it("returns the task with comments and events, newest event last", async () => {
    const project = seedProject(db, { id: "proj-a", name: "Project A" });
    const task = seedTask(db, { code: "PRJ-1", title: "Fix retries", status: "in_progress" });
    seedComment(db, task.id, "comment");
    seedEvent(db, project.id, task.id, "created", "2026-01-01T10:00:00.000Z");
    seedEvent(db, project.id, task.id, "claimed", "2026-01-01T11:00:00.000Z");
    seedEvent(db, project.id, task.id, "status_changed", "2026-01-01T12:00:00.000Z");

    const payload = textPayload<TaskDetailPayload>(
      await handlers.getTask({ task_code: "PRJ-1" }),
    );

    expect(payload.projectId).toBe("proj-a");
    expect(payload.projectName).toBe("Project A");
    expect(payload.task.code).toBe("PRJ-1");
    expect(payload.task.comments).toHaveLength(1);
    expect(payload.task.attachments).toEqual([]);
    expect(payload.task.events.map((event) => event.eventType)).toEqual([
      "created",
      "claimed",
      "status_changed",
    ]);
  });

  it("fails with task_not_found for an unknown code", async () => {
    seedProject(db);

    const result = await handlers.getTask({ task_code: "PRJ-999" });

    expect(result.isError).toBe(true);
    const text = result.content[0];
    if (text?.type !== "text") throw new Error("expected text result");
    expect(text.text).toContain("task_not_found");
  });

  it("fails for a code outside the PREFIX-N pattern", async () => {
    seedProject(db);

    const result = await handlers.getTask({ task_code: "not-a-code" });

    expect(result.isError).toBe(true);
  });
});

describe("list_doubts", () => {
  it("sorts by task priority, then created_at, and skips resolved doubts", async () => {
    const project = seedProject(db);
    const low = seedTask(db, { code: "PRJ-1", priority: "low" });
    const urgent = seedTask(db, { code: "PRJ-2", priority: "urgent" });
    const high = seedTask(db, { code: "PRJ-3", priority: "high" });
    const medium = seedTask(db, { code: "PRJ-4", priority: "medium" });

    seedDoubt(db, low.id, { body: "low", createdAt: "2026-01-01T09:00:00.000Z" });
    seedDoubt(db, urgent.id, { body: "urgent late", createdAt: "2026-01-01T11:00:00.000Z" });
    seedDoubt(db, urgent.id, { body: "urgent early", createdAt: "2026-01-01T10:00:00.000Z" });
    seedDoubt(db, high.id, { body: "high", createdAt: "2026-01-01T09:00:00.000Z" });
    seedDoubt(db, medium.id, { body: "medium", createdAt: "2026-01-01T09:00:00.000Z" });
    seedDoubt(db, urgent.id, {
      body: "already answered",
      createdAt: "2026-01-01T08:00:00.000Z",
      resolved: true,
    });

    const payload = textPayload<DoubtsPayload>(
      await handlers.listDoubts({ project_id: project.id }),
    );

    expect(payload.doubts.map((doubt) => doubt.comment.body)).toEqual([
      "urgent early",
      "urgent late",
      "high",
      "medium",
      "low",
    ]);
    expect(payload.doubts.every((doubt) => doubt.comment.isResolved === false)).toBe(true);
    expect(payload.doubts[0]?.task).toMatchObject({
      code: "PRJ-2",
      title: "Task PRJ-2",
      priority: "urgent",
      status: "ready",
      projectId: project.id,
      projectName: "Project A",
    });

    const all = textPayload<DoubtsPayload>(
      await handlers.listDoubts({ project_id: project.id, only_open: false }),
    );
    expect(all.doubts).toHaveLength(6);
  });

  it("scopes to project_id (even inactive) and defaults to active projects only", async () => {
    const active = seedProject(db, { id: "proj-a", name: "Project A" });
    const inactive = seedProject(db, {
      id: "proj-b",
      codePrefix: "PRB",
      name: "Project B",
      relPath: "project-b",
      active: false,
    });
    const activeTask = seedTask(db, { projectId: active.id, code: "PRJ-1", priority: "low" });
    const inactiveTask = seedTask(db, { projectId: inactive.id, code: "PRB-1", priority: "urgent" });
    seedDoubt(db, activeTask.id, { body: "active doubt", createdAt: "2026-01-01T09:00:00.000Z" });
    seedDoubt(db, inactiveTask.id, { body: "inactive doubt", createdAt: "2026-01-01T09:00:00.000Z" });

    const unscoped = textPayload<DoubtsPayload>(await handlers.listDoubts({}));
    expect(unscoped.doubts.map((doubt) => doubt.task.code)).toEqual(["PRJ-1"]);

    const scoped = textPayload<DoubtsPayload>(await handlers.listDoubts({ project_id: "proj-b" }));
    expect(scoped.doubts.map((doubt) => doubt.task.code)).toEqual(["PRB-1"]);
    expect(scoped.doubts[0]?.task.projectName).toBe("Project B");
  });
});

describe("create_tasks", () => {
  it("creates tasks in bulk and returns their codes", async () => {
    const project = seedProject(db);

    const payload = textPayload<{ codes: string[]; tasks: { title: string; status: string }[] }>(
      await handlers.createTasks({
        project_id: project.id,
        tasks: [
          { title: "First", priority: "high", plan_file: "plan.md", plan_section: "goal" },
          { title: "Second", status: "ready" },
        ],
      }),
    );

    expect(payload.codes).toEqual(["PRJ-1", "PRJ-2"]);
    expect(payload.tasks[1]?.status).toBe("ready");

    const rows = db
      .query<{ code: string; plan_file: string | null; plan_section: string | null }, []>(
        "SELECT code, plan_file, plan_section FROM tasks ORDER BY code",
      )
      .all();
    expect(rows).toEqual([
      { code: "PRJ-1", plan_file: "plan.md", plan_section: "goal" },
      { code: "PRJ-2", plan_file: null, plan_section: null },
    ]);

    const projectRow = db
      .query<{ next_task_seq: number }, [string]>("SELECT next_task_seq FROM projects WHERE id = ?")
      .get(project.id);
    expect(projectRow?.next_task_seq).toBe(3);
  });

  it("rejects more than 100 tasks", async () => {
    const project = seedProject(db);
    const tasks = Array.from({ length: 101 }, (_, index) => ({ title: `Task ${index}` }));

    const result = await handlers.createTasks({ project_id: project.id, tasks });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
  });

  it("rejects duplicate titles against existing tasks and rolls the batch back", async () => {
    const project = seedProject(db, { nextTaskSeq: 2 });
    seedTask(db, { code: "PRJ-1", title: "Existing", status: "backlog" });

    const result = await handlers.createTasks({
      project_id: project.id,
      tasks: [{ title: "Brand new" }, { title: "  EXISTING " }],
    });

    expect(result.isError).toBe(true);
    const text = result.content[0];
    if (text?.type !== "text") throw new Error("expected text result");
    expect(text.text.toLowerCase()).toContain("existing");
    expect(
      (db.query("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count,
    ).toBe(1);
    const projectRow = db
      .query<{ next_task_seq: number }, [string]>("SELECT next_task_seq FROM projects WHERE id = ?")
      .get(project.id);
    expect(projectRow?.next_task_seq).toBe(2);
  });

  it("rejects duplicates inside one batch and reports every rejected title", async () => {
    const project = seedProject(db);

    const result = await handlers.createTasks({
      project_id: project.id,
      tasks: [
        { title: "Payment", plan_section: "S1" },
        { title: " payment ", plan_section: "S1" },
      ],
    });

    expect(result.isError).toBe(true);
    const text = result.content[0];
    if (text?.type !== "text") throw new Error("expected text result");
    expect(text.text).toContain("payment");
    expect(
      (db.query("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count,
    ).toBe(0);
  });

  it("rejects a title that already exists in the project, whatever the plan section", async () => {
    const project = seedProject(db, { nextTaskSeq: 2 });
    seedTask(db, { code: "PRJ-1", title: "Shared", status: "backlog", planSection: "S1" });

    const result = await handlers.createTasks({
      project_id: project.id,
      tasks: [{ title: "shared", plan_section: "S2" }],
    });
    expect(result.isError).toBe(true);
    expect(db.query("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 1 });
  });
});

describe("update_task", () => {
  it("updates status and records an event", async () => {
    seedProject(db);
    const task = seedTask(db, { code: "PRJ-1", status: "ready" });

    const payload = textPayload<{ task: { status: string; completedAt: string | null } }>(
      await handlers.updateTask({ task_code: "PRJ-1", status: "done" }),
    );

    expect(payload.task.status).toBe("done");
    expect(payload.task.completedAt).not.toBeNull();

    const event = db
      .query<{ old_value: string; new_value: string }, [number]>(
        "SELECT old_value, new_value FROM task_events WHERE task_id = ? AND event_type = 'completed'",
      )
      .get(task.id);
    expect(event).toEqual({ old_value: "ready", new_value: "done" });
  });
});

describe("add_entry", () => {
  it("adds a doubt and moves the task to needs_input", async () => {
    seedProject(db);
    seedTask(db, { code: "PRJ-1", status: "ready" });

    const payload = textPayload<{
      comment: { kind: string; authorType: string; authorName: string };
      task: { status: string };
    }>(
      await handlers.addEntry({
        task_code: "PRJ-1",
        kind: "doubt",
        body: "Which retry strategy?",
        author_name: "agent-alpha",
      }),
    );

    expect(payload.comment).toMatchObject({
      kind: "doubt",
      authorType: "agent",
      authorName: "agent-alpha",
    });
    expect(payload.task.status).toBe("needs_input");

    const row = db
      .query<{ status: string }, [string]>("SELECT status FROM tasks WHERE code = ?")
      .get("PRJ-1");
    expect(row?.status).toBe("needs_input");

    const event = db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM task_events WHERE event_type = 'doubt_opened'",
      )
      .get();
    expect(event?.count).toBe(1);
  });

  it("keeps done tasks done when a doubt arrives", async () => {
    seedProject(db);
    seedTask(db, { code: "PRJ-1", status: "done" });

    const payload = textPayload<{ task: { status: string } }>(
      await handlers.addEntry({ task_code: "PRJ-1", kind: "doubt", body: "Late question" }),
    );

    expect(payload.task.status).toBe("done");
  });
});

describe("get_attachment", () => {
  it("returns an image block for image attachments", async () => {
    seedProject(db);
    const task = seedTask(db, { code: "PRJ-1" });

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const storagePath = path.join(ctx.dataDir, "shot.png");
    await Bun.write(storagePath, bytes);

    const inserted = db.run(
      `INSERT INTO attachments (task_id, comment_id, filename, mime_type, storage_path, size_bytes, created_at)
       VALUES (?, NULL, 'shot.png', 'image/png', ?, ?, ?)`,
      [task.id, storagePath, bytes.byteLength, new Date().toISOString()],
    );

    const result = await handlers.getAttachment({
      attachment_id: Number(inserted.lastInsertRowid),
    });

    expect(result.isError).toBeUndefined();
    const images = imageBlocks(result);
    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe("image/png");
    expect(Buffer.from(images[0]?.data ?? "", "base64")).toEqual(Buffer.from(bytes));
  });

  it("returns text for log attachments", async () => {
    seedProject(db);
    const task = seedTask(db, { code: "PRJ-1" });
    const storagePath = path.join(ctx.dataDir, "build.log");
    await Bun.write(storagePath, "line one\nline two");

    const inserted = db.run(
      `INSERT INTO attachments (task_id, comment_id, filename, mime_type, storage_path, size_bytes, created_at)
       VALUES (?, NULL, 'build.log', 'text/plain', ?, ?, ?)`,
      [task.id, storagePath, 17, new Date().toISOString()],
    );

    const result = await handlers.getAttachment({
      attachment_id: Number(inserted.lastInsertRowid),
    });
    const text = result.content[0];
    expect(text?.type).toBe("text");
    if (text?.type === "text") {
      expect(text.text).toContain("line two");
    }
  });

  it("rejects attachments above the configured mcp_attachment_max_bytes and reports the limit", async () => {
    const limited = createMcpTestContext({ config: { mcp_attachment_max_bytes: 8 } });
    try {
      seedProject(limited.db);
      const task = seedTask(limited.db, { code: "PRJ-1" });

      const insert = async (name: string, size: number) => {
        const storagePath = path.join(limited.dataDir, name);
        await Bun.write(storagePath, new Uint8Array(size));
        const inserted = limited.db.run(
          `INSERT INTO attachments (task_id, comment_id, filename, mime_type, storage_path, size_bytes, created_at)
           VALUES (?, NULL, ?, 'text/plain', ?, ?, ?)`,
          [task.id, name, storagePath, size, new Date().toISOString()],
        );
        return Number(inserted.lastInsertRowid);
      };

      const tooBig = await limited.handlers.getAttachment({ attachment_id: await insert("big.log", 9) });
      expect(tooBig.isError).toBe(true);
      const text = tooBig.content[0];
      if (text?.type !== "text") throw new Error("expected text result");
      expect(text.text).toContain("8");

      const atLimit = await limited.handlers.getAttachment({ attachment_id: await insert("ok.log", 8) });
      expect(atLimit.isError).toBeUndefined();
    } finally {
      limited.close();
    }
  });
});

describe("get_project_context", () => {
  it("resolves the project from cwd and returns plan headings, worktrees and board status", async () => {
    const project = seedProject(db, { planFiles: ["plan.md"] });
    seedTask(db, { code: "PRJ-1", status: "ready" });
    seedTask(db, { code: "PRJ-2", status: "done" });

    const planPath = path.join(ctx.workspaceDir, project.relPath, "plan.md");
    await Bun.write(planPath, "# Plan\n\n## Goals\n\n### Step one\n\nText\n");

    const payload = textPayload<{
      project: { id: string };
      plan: {
        available: boolean;
        files: { path: string; exists: boolean; headings: { title: string; slug: string }[] }[];
      };
      worktrees: unknown[];
      board: { statuses: Record<string, number> };
    }>(await handlers.getProjectContext({ cwd: path.join(ctx.workspaceDir, project.relPath, "src") }));

    expect(payload.project.id).toBe(project.id);
    expect(payload.plan.available).toBe(true);
    expect(payload.plan.files[0]).toMatchObject({ path: "plan.md", exists: true });
    expect(payload.plan.files[0]?.headings.map((heading) => heading.title)).toEqual([
      "Plan",
      "Goals",
      "Step one",
    ]);
    expect(payload.worktrees).toEqual([]);
    expect(payload.board.statuses).toMatchObject({ ready: 1, done: 1, in_progress: 0 });
  });

  it("fails for a cwd outside every project", async () => {
    seedProject(db);
    const result = await handlers.getProjectContext({ cwd: "/definitely/not/a/project" });
    expect(result.isError).toBe(true);
  });

  it("includes *.md files from the default plan dirs with their origin", async () => {
    const project = seedProject(db, { planFiles: ["plan.md"] });
    await Bun.write(
      path.join(ctx.workspaceDir, project.relPath, "context/foundation/prd.md"),
      "# PRD\n\n## Cel\n",
    );

    const payload = textPayload<{
      plan: {
        truncated: boolean;
        files: { path: string; origin: string; exists: boolean }[];
      };
    }>(await handlers.getProjectContext({ project_id: project.id }));

    expect(payload.plan.truncated).toBe(false);
    expect(payload.plan.files.map((file) => [file.path, file.origin, file.exists])).toEqual([
      ["plan.md", "file", false],
      ["context/foundation/prd.md", "dir", true],
    ]);
  });

  it("honours a project planDirs override instead of the config default", async () => {
    const project = seedProject(db, { planFiles: [], planDirs: ["specs"] });
    await Bun.write(path.join(ctx.workspaceDir, project.relPath, "context/prd.md"), "# Context\n");
    await Bun.write(path.join(ctx.workspaceDir, project.relPath, "specs/plan.md"), "# Specs\n");

    const payload = textPayload<{
      plan: { files: { path: string }[] };
    }>(await handlers.getProjectContext({ project_id: project.id }));

    expect(payload.plan.files.map((file) => file.path)).toEqual(["specs/plan.md"]);
  });
});
