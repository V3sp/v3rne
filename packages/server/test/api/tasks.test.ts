import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Comment, Task, TaskEvent } from "@v3rne/shared";
import {
  countRows,
  createTask,
  createTestApp,
  deleteJson,
  getJson,
  insertProject,
  patchJson,
  postJson,
  type TestApp,
} from "./helpers";

interface TaskDetail extends Task {
  comments: Comment[];
  attachments: unknown[];
  events: TaskEvent[];
}

interface DoubtItem {
  comment: Comment;
  task: {
    code: string;
    title: string;
    priority: string;
    projectId: string;
    projectName: string;
  };
}

describe("tasks API", () => {
  let ctx: TestApp;

  beforeEach(() => {
    ctx = createTestApp();
    insertProject(ctx.db);
  });

  afterEach(() => {
    ctx.close();
  });

  test("creates tasks with sequential codes and a created event", async () => {
    const first = await createTask(ctx.app, { title: "First task" });
    const second = await createTask(ctx.app, { title: "Second task" });

    expect(first.code).toBe("PRJ-1");
    expect(first.status).toBe("backlog");
    expect(first.priority).toBe("medium");
    expect(first.planFile).toBeNull();
    expect(second.code).toBe("PRJ-2");

    const project = ctx.db
      .query<{ next_task_seq: number }, []>("SELECT next_task_seq FROM projects WHERE id = 'proj-a'")
      .get();
    expect(project?.next_task_seq).toBe(3);

    const res = await getJson(ctx.app, "/tasks/PRJ-1");
    expect(res.status).toBe(200);
    const detail = (await res.json()) as TaskDetail;
    expect(detail.code).toBe("PRJ-1");
    expect(detail.comments).toEqual([]);
    expect(detail.attachments).toEqual([]);
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.eventType).toBe("created");
    expect(detail.events[0]?.newValue).toBe("backlog");
  });

  test("stores plan fields and allows backlog or ready on create", async () => {
    const task = await createTask(ctx.app, {
      title: "Planned",
      description: "details",
      planFile: "plan.md",
      planSection: "Faza 2",
      priority: "urgent",
      status: "ready",
    });

    expect(task.planFile).toBe("plan.md");
    expect(task.planSection).toBe("Faza 2");
    expect(task.priority).toBe("urgent");
    expect(task.status).toBe("ready");
    expect(task.description).toBe("details");
  });

  test("rejects invalid create payloads", async () => {
    const missingTitle = await postJson(ctx.app, "/projects/proj-a/tasks", { description: "x" });
    expect(missingTitle.status).toBe(400);
    const body = (await missingTitle.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_error");

    const badStatus = await postJson(ctx.app, "/projects/proj-a/tasks", {
      title: "x",
      status: "in_progress",
    });
    expect(badStatus.status).toBe(400);

    const badPriority = await postJson(ctx.app, "/projects/proj-a/tasks", { title: "x", priority: "p0" });
    expect(badPriority.status).toBe(400);

    const unknownProject = await postJson(ctx.app, "/projects/nope/tasks", { title: "x" });
    expect(unknownProject.status).toBe(404);
    expect(((await unknownProject.json()) as { error: { code: string } }).error.code).toBe(
      "project_not_found",
    );

    expect(countRows(ctx.db, "tasks")).toBe(0);
  });

  test("lists tasks with status, priority and planSection filters", async () => {
    await createTask(ctx.app, { title: "A", status: "ready", priority: "low", planSection: "S1" });
    await createTask(ctx.app, { title: "B", status: "ready", priority: "urgent", planSection: "S2" });
    await createTask(ctx.app, { title: "C", status: "backlog", priority: "urgent", planSection: "S1" });

    const all = (await (await getJson(ctx.app, "/projects/proj-a/tasks")).json()) as { tasks: Task[] };
    expect(all.tasks.map((task) => task.code)).toEqual(["PRJ-2", "PRJ-3", "PRJ-1"]);

    const ready = (await (await getJson(ctx.app, "/projects/proj-a/tasks?status=ready")).json()) as {
      tasks: Task[];
    };
    expect(ready.tasks.map((task) => task.code)).toEqual(["PRJ-2", "PRJ-1"]);

    const urgent = (await (await getJson(ctx.app, "/projects/proj-a/tasks?priority=urgent")).json()) as {
      tasks: Task[];
    };
    expect(urgent.tasks.map((task) => task.code)).toEqual(["PRJ-2", "PRJ-3"]);

    const section = (await (await getJson(ctx.app, "/projects/proj-a/tasks?planSection=S1")).json()) as {
      tasks: Task[];
    };
    expect(section.tasks.map((task) => task.code)).toEqual(["PRJ-3", "PRJ-1"]);

    const invalid = await getJson(ctx.app, "/projects/proj-a/tasks?status=unknown");
    expect(invalid.status).toBe(400);

    const unknownProject = await getJson(ctx.app, "/projects/nope/tasks");
    expect(unknownProject.status).toBe(404);
  });

  test("bulk creates tasks in one transaction and returns codes", async () => {
    const res = await postJson(ctx.app, "/projects/proj-a/tasks/bulk", [
      { title: "Bulk one" },
      { title: "Bulk two", priority: "high", status: "ready" },
      { title: "Bulk three", planSection: "S3" },
    ]);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { tasks: Task[] };
    expect(body.tasks.map((task) => task.code)).toEqual(["PRJ-1", "PRJ-2", "PRJ-3"]);
    expect(body.tasks[1]?.priority).toBe("high");
    expect(body.tasks[1]?.status).toBe("ready");
    expect(countRows(ctx.db, "task_events")).toBe(3);
  });

  test("bulk rolls the whole batch back when one item is invalid", async () => {
    const res = await postJson(ctx.app, "/projects/proj-a/tasks/bulk", [
      { title: "Valid" },
      { title: "" },
      { title: "Also valid" },
    ]);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("tasks[1]");

    expect(countRows(ctx.db, "tasks")).toBe(0);
    const project = ctx.db
      .query<{ next_task_seq: number }, []>("SELECT next_task_seq FROM projects WHERE id = 'proj-a'")
      .get();
    expect(project?.next_task_seq).toBe(1);

    const notArray = await postJson(ctx.app, "/projects/proj-a/tasks/bulk", { title: "x" });
    expect(notArray.status).toBe(400);

    const empty = await postJson(ctx.app, "/projects/proj-a/tasks/bulk", []);
    expect(empty.status).toBe(400);
  });

  test("bulk rejects more than 100 tasks", async () => {
    const items = Array.from({ length: 101 }, (_, index) => ({ title: `Task ${index}` }));
    const res = await postJson(ctx.app, "/projects/proj-a/tasks/bulk", items);
    expect(res.status).toBe(400);
    expect(countRows(ctx.db, "tasks")).toBe(0);
  });

  test("single create rejects a duplicate title in the project with 409", async () => {
    await createTask(ctx.app, { title: "Existing", planSection: "S1" });

    const duplicate = await postJson(ctx.app, "/projects/proj-a/tasks", {
      title: "  existing ",
      planSection: "S2",
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe(
      "duplicate_title",
    );
    expect(countRows(ctx.db, "tasks")).toBe(1);

    const fresh = await postJson(ctx.app, "/projects/proj-a/tasks", { title: "Fresh" });
    expect(fresh.status).toBe(201);
  });

  test("bulk rejects duplicate titles anywhere in the project", async () => {
    await createTask(ctx.app, { title: "Existing", planSection: "S1" });

    const inBatch = await postJson(ctx.app, "/projects/proj-a/tasks/bulk", [
      { title: "Fresh", planSection: "S1" },
      { title: "  fresh  ", planSection: "S1" },
    ]);
    expect(inBatch.status).toBe(409);
    const inBatchBody = (await inBatch.json()) as {
      error: { code: string; index: number; message: string };
      index: number;
    };
    expect(inBatchBody.error.code).toBe("duplicate_title");
    expect(inBatchBody.index).toBe(1);
    expect(inBatchBody.error.index).toBe(1);
    expect(countRows(ctx.db, "tasks")).toBe(1);

    const againstExisting = await postJson(ctx.app, "/projects/proj-a/tasks/bulk", [
      { title: "  EXISTING ", planSection: "S1" },
    ]);
    expect(againstExisting.status).toBe(409);
    expect(((await againstExisting.json()) as { error: { code: string } }).error.code).toBe(
      "duplicate_title",
    );

    const otherSection = await postJson(ctx.app, "/projects/proj-a/tasks/bulk", [
      { title: "Existing", planSection: "S2" },
    ]);
    expect(otherSection.status).toBe(409);
    expect(countRows(ctx.db, "tasks")).toBe(1);

    const project = ctx.db
      .query<{ next_task_seq: number }, []>("SELECT next_task_seq FROM projects WHERE id = 'proj-a'")
      .get();
    expect(project?.next_task_seq).toBe(2);
  });

  test("patch sets completed_at and events on done, clears it on any other status", async () => {
    const task = await createTask(ctx.app, { title: "Do me" });

    const done = await patchJson(ctx.app, `/tasks/${task.code}`, { status: "done" });
    expect(done.status).toBe(200);
    const doneTask = (await done.json()) as Task;
    expect(doneTask.status).toBe("done");
    expect(doneTask.completedAt).not.toBeNull();

    const events = ctx.db
      .query<{ event_type: string; old_value: string | null; new_value: string | null }, [number]>(
        "SELECT event_type, old_value, new_value FROM task_events WHERE task_id = ? ORDER BY id ASC",
      )
      .all(task.id);
    const completedEvent = events.find((event) => event.event_type === "completed");
    expect(completedEvent?.old_value).toBe("backlog");
    expect(completedEvent?.new_value).toBe("done");

    const reopened = await patchJson(ctx.app, `/tasks/${task.code}`, { status: "ready" });
    const reopenedTask = (await reopened.json()) as Task;
    expect(reopenedTask.status).toBe("ready");
    expect(reopenedTask.completedAt).toBeNull();

    const statusEvents = ctx.db
      .query<{ event_type: string }, [number]>(
        "SELECT event_type FROM task_events WHERE task_id = ? AND event_type = 'status_changed'",
      )
      .all(task.id);
    expect(statusEvents).toHaveLength(1);
  });

  test("patch priority, plan fields and metadata without status restrictions", async () => {
    const task = await createTask(ctx.app, { title: "Edit me" });

    const res = await patchJson(ctx.app, `/tasks/${task.code}`, {
      priority: "high",
      sortOrder: 7,
      planFile: "docs/plan.md",
      planSection: "Faza 3",
      claimedBy: "opencode",
      gitBranch: "feature/x",
      description: "new description",
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Task;
    expect(updated.priority).toBe("high");
    expect(updated.sortOrder).toBe(7);
    expect(updated.planFile).toBe("docs/plan.md");
    expect(updated.planSection).toBe("Faza 3");
    expect(updated.claimedBy).toBe("opencode");
    expect(updated.gitBranch).toBe("feature/x");
    expect(updated.description).toBe("new description");

    const priorityEvent = ctx.db
      .query<{ event_type: string; old_value: string | null; new_value: string | null }, [number]>(
        "SELECT event_type, old_value, new_value FROM task_events WHERE task_id = ? AND event_type = 'priority_changed'",
      )
      .get(task.id);
    expect(priorityEvent?.old_value).toBe("medium");
    expect(priorityEvent?.new_value).toBe("high");

    const needsInput = await patchJson(ctx.app, `/tasks/${task.code}`, { status: "needs_input" });
    expect(needsInput.status).toBe(200);
    expect(((await needsInput.json()) as Task).status).toBe("needs_input");

    const cleared = await patchJson(ctx.app, `/tasks/${task.code}`, { gitBranch: null });
    expect(((await cleared.json()) as Task).gitBranch).toBeNull();
  });

  test("patch rejects invalid values and unknown tasks", async () => {
    const task = await createTask(ctx.app, { title: "Edit me" });

    expect((await patchJson(ctx.app, `/tasks/${task.code}`, { status: "nope" })).status).toBe(400);
    expect((await patchJson(ctx.app, `/tasks/${task.code}`, { priority: "10" })).status).toBe(400);
    expect((await patchJson(ctx.app, "/tasks/PRJ-999", { status: "done" })).status).toBe(404);
    expect((await getJson(ctx.app, "/tasks/PRJ-999")).status).toBe(404);
    expect((await deleteJson(ctx.app, "/tasks/PRJ-999")).status).toBe(404);
  });

  test("deletes a task and cascades comments and events", async () => {
    const task = await createTask(ctx.app, { title: "Delete me" });
    await postJson(ctx.app, `/tasks/${task.code}/comments`, {
      authorType: "human",
      authorName: "Ty",
      kind: "comment",
      body: "hello",
    });

    const res = await deleteJson(ctx.app, `/tasks/${task.code}`);
    expect(res.status).toBe(204);

    expect((await getJson(ctx.app, `/tasks/${task.code}`)).status).toBe(404);
    expect(countRows(ctx.db, "tasks")).toBe(0);
    expect(countRows(ctx.db, "comments")).toBe(0);
    expect(countRows(ctx.db, "task_events")).toBe(0);
  });

  test("deleting a task removes its attachment files from disk", async () => {
    const task = await createTask(ctx.app, { title: "Files" });
    const storagePath = path.join(ctx.dataDir, "uploads", "proj-a", task.code, "log.txt");
    await mkdir(path.dirname(storagePath), { recursive: true });
    await Bun.write(storagePath, "log line");
    ctx.db.run(
      `INSERT INTO attachments (task_id, comment_id, filename, mime_type, storage_path, size_bytes, created_at)
       VALUES (?, NULL, 'log.txt', 'text/plain', ?, ?, ?)`,
      [task.id, storagePath, 8, new Date().toISOString()],
    );

    const res = await deleteJson(ctx.app, `/tasks/${task.code}`);
    expect(res.status).toBe(204);
    expect(await Bun.file(storagePath).exists()).toBe(false);
    expect(countRows(ctx.db, "attachments")).toBe(0);
  });

  test("a failing attachment unlink is logged but does not block task deletion", async () => {
    const task = await createTask(ctx.app, { title: "Broken file" });
    const directoryPath = path.join(ctx.dataDir, "not-a-file");
    await mkdir(directoryPath, { recursive: true });
    ctx.db.run(
      `INSERT INTO attachments (task_id, comment_id, filename, mime_type, storage_path, size_bytes, created_at)
       VALUES (?, NULL, 'broken.txt', 'text/plain', ?, 0, ?)`,
      [task.id, directoryPath, new Date().toISOString()],
    );

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await deleteJson(ctx.app, `/tasks/${task.code}`);
      expect(res.status).toBe(204);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    expect(countRows(ctx.db, "tasks")).toBe(0);
  });

  test("doubt switches the task to needs_input and resolving returns it to ready", async () => {
    const task = await createTask(ctx.app, { title: "Blocked", status: "ready" });

    const commentRes = await postJson(ctx.app, `/tasks/${task.code}/comments`, {
      authorType: "agent",
      authorName: "opencode",
      kind: "doubt",
      body: "Which database?",
    });
    expect(commentRes.status).toBe(201);
    const doubt = (await commentRes.json()) as Comment;
    expect(doubt.kind).toBe("doubt");
    expect(doubt.isResolved).toBe(false);

    const blocked = (await (await getJson(ctx.app, `/tasks/${task.code}`)).json()) as TaskDetail;
    expect(blocked.status).toBe("needs_input");
    expect(blocked.comments).toHaveLength(1);
    const doubtOpened = blocked.events.find((event) => event.eventType === "doubt_opened");
    expect(doubtOpened).toBeDefined();
    expect(doubtOpened?.oldValue).toBe("ready");
    expect(doubtOpened?.newValue).toBe("needs_input");
    expect(doubtOpened?.actor).toBe("opencode");

    const resolveRes = await postJson(ctx.app, `/comments/${doubt.id}/resolve`, { reply: "SQLite" });
    expect(resolveRes.status).toBe(200);
    const resolved = (await resolveRes.json()) as {
      comment: Comment;
      doubt: Comment;
      task: Task;
      statusChanged: boolean;
    };
    expect(resolved.comment.kind).toBe("decision");
    expect(resolved.comment.body).toBe("SQLite");
    expect(resolved.comment.isResolved).toBe(true);
    expect(resolved.doubt.isResolved).toBe(true);
    expect(resolved.task.status).toBe("ready");
    expect(resolved.statusChanged).toBe(true);

    const detail = (await (await getJson(ctx.app, `/tasks/${task.code}`)).json()) as TaskDetail;
    expect(detail.status).toBe("ready");
    expect(detail.comments).toHaveLength(2);
    expect(detail.comments[1]?.kind).toBe("decision");
    const eventTypes = detail.events.map((event) => event.eventType);
    expect(eventTypes).toContain("doubt_resolved");
    expect(eventTypes).toContain("status_changed");
  });

  test("resolve returns 409 for non-doubt and already resolved comments", async () => {
    const task = await createTask(ctx.app, { title: "Mixed" });
    const plain = (await (
      await postJson(ctx.app, `/tasks/${task.code}/comments`, {
        authorType: "human",
        authorName: "Ty",
        kind: "comment",
        body: "just a comment",
      })
    ).json()) as Comment;

    const plainRes = await postJson(ctx.app, `/comments/${plain.id}/resolve`, { reply: "nope" });
    expect(plainRes.status).toBe(409);
    expect(((await plainRes.json()) as { error: { code: string } }).error.code).toBe("not_a_doubt");

    const doubt = (await (
      await postJson(ctx.app, `/tasks/${task.code}/comments`, {
        authorType: "agent",
        authorName: "opencode",
        kind: "doubt",
        body: "question",
      })
    ).json()) as Comment;

    expect((await postJson(ctx.app, `/comments/${doubt.id}/resolve`, { reply: "answer" })).status).toBe(200);
    const again = await postJson(ctx.app, `/comments/${doubt.id}/resolve`, { reply: "answer again" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("already_resolved");

    expect((await postJson(ctx.app, "/comments/9999/resolve", { reply: "x" })).status).toBe(404);
    expect((await postJson(ctx.app, `/comments/${doubt.id}/resolve`, { reply: "  " })).status).toBe(400);
  });

  test("resolve keeps needs_input while another doubt is open", async () => {
    const task = await createTask(ctx.app, { title: "Two doubts", status: "ready" });

    const first = (await (
      await postJson(ctx.app, `/tasks/${task.code}/comments`, {
        authorType: "agent",
        authorName: "opencode",
        kind: "doubt",
        body: "first",
      })
    ).json()) as Comment;
    const second = (await (
      await postJson(ctx.app, `/tasks/${task.code}/comments`, {
        authorType: "agent",
        authorName: "opencode",
        kind: "doubt",
        body: "second",
      })
    ).json()) as Comment;

    const res = await postJson(ctx.app, `/comments/${first.id}/resolve`, { reply: "first answer" });
    const body = (await res.json()) as { task: Task; statusChanged: boolean };
    expect(body.task.status).toBe("needs_input");
    expect(body.statusChanged).toBe(false);

    const final = await postJson(ctx.app, `/comments/${second.id}/resolve`, { reply: "second answer" });
    const finalBody = (await final.json()) as { task: Task; statusChanged: boolean };
    expect(finalBody.task.status).toBe("ready");
    expect(finalBody.statusChanged).toBe(true);
  });

  test("doubt on a done task does not change its status", async () => {
    const task = await createTask(ctx.app, { title: "Closed" });
    await patchJson(ctx.app, `/tasks/${task.code}`, { status: "done" });

    await postJson(ctx.app, `/tasks/${task.code}/comments`, {
      authorType: "agent",
      authorName: "opencode",
      kind: "doubt",
      body: "late question",
    });

    const detail = (await (await getJson(ctx.app, `/tasks/${task.code}`)).json()) as TaskDetail;
    expect(detail.status).toBe("done");
    expect(detail.events.some((event) => event.eventType === "doubt_opened")).toBe(false);
  });

  test("comments are returned chronologically and progress does not change status", async () => {
    const task = await createTask(ctx.app, { title: "Thread", status: "ready" });

    for (const body of ["one", "two", "three"]) {
      await postJson(ctx.app, `/tasks/${task.code}/comments`, {
        authorType: "agent",
        authorName: "opencode",
        kind: "progress",
        body,
      });
    }

    const detail = (await (await getJson(ctx.app, `/tasks/${task.code}`)).json()) as TaskDetail;
    expect(detail.comments.map((comment) => comment.body)).toEqual(["one", "two", "three"]);
    expect(detail.status).toBe("ready");

    const invalid = await postJson(ctx.app, `/tasks/${task.code}/comments`, {
      authorType: "robot",
      authorName: "x",
      kind: "comment",
      body: "hi",
    });
    expect(invalid.status).toBe(400);
  });

  test("GET /doubts sorts by task priority, then by age", async () => {
    const low = await createTask(ctx.app, { title: "Low", priority: "low" });
    const urgent = await createTask(ctx.app, { title: "Urgent", priority: "urgent" });
    const medium = await createTask(ctx.app, { title: "Medium", priority: "medium" });

    const openDoubt = async (code: string, body: string) => {
      const res = await postJson(ctx.app, `/tasks/${code}/comments`, {
        authorType: "agent",
        authorName: "opencode",
        kind: "doubt",
        body,
      });
      return (await res.json()) as Comment;
    };

    await openDoubt(low.code, "low doubt");
    await openDoubt(medium.code, "medium doubt");
    const urgentDoubt = await openDoubt(urgent.code, "urgent doubt");

    const res = await getJson(ctx.app, "/doubts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { doubts: DoubtItem[] };
    expect(body.doubts.map((item) => item.task.code)).toEqual(["PRJ-2", "PRJ-3", "PRJ-1"]);
    expect(body.doubts[0]?.task.priority).toBe("urgent");
    expect(body.doubts[0]?.task.projectName).toBe("Project A");
    expect(body.doubts[0]?.task.projectId).toBe("proj-a");
    expect(body.doubts[0]?.comment.id).toBe(urgentDoubt.id);

    await postJson(ctx.app, `/comments/${urgentDoubt.id}/resolve`, { reply: "done" });
    const afterResolve = (await (await getJson(ctx.app, "/doubts")).json()) as { doubts: DoubtItem[] };
    expect(afterResolve.doubts.map((item) => item.task.code)).toEqual(["PRJ-3", "PRJ-1"]);
  });
});
