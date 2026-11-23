import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isoWeekKey, lastIsoWeeks } from "../../src/api/stats";
import {
  createTask,
  createTestApp,
  getJson,
  insertEvent,
  insertProject,
  patchJson,
  type TestApp,
} from "./helpers";

interface StatsResponse {
  generatedAt: string;
  velocity: { week: string; count: number }[];
  doubts: { averageMinutes: number | null; resolvedCount: number; openCount: number };
  statusByProject: {
    projectId: string;
    projectName: string;
    statuses: Record<string, number>;
    total: number;
  }[];
  recentEvents: {
    id: number;
    projectId: string;
    projectName: string;
    taskId: number;
    taskCode: string;
    eventType: string;
    oldValue: string | null;
    newValue: string | null;
    actor: string;
    createdAt: string;
  }[];
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe("stats API", () => {
  let ctx: TestApp;

  beforeEach(() => {
    ctx = createTestApp();
    insertProject(ctx.db);
  });

  afterEach(() => {
    ctx.close();
  });

  test("returns an empty but well-formed payload", async () => {
    const res = await getJson(ctx.app, "/stats");
    expect(res.status).toBe(200);

    const stats = (await res.json()) as StatsResponse;
    expect(stats.velocity).toHaveLength(8);
    expect(stats.velocity.every((entry) => entry.count === 0)).toBe(true);
    expect(stats.velocity.map((entry) => entry.week)).toEqual(lastIsoWeeks(new Date(), 8));
    expect(stats.doubts.averageMinutes).toBeNull();
    expect(stats.doubts.resolvedCount).toBe(0);
    expect(stats.doubts.openCount).toBe(0);
    expect(stats.statusByProject).toEqual([
      {
        projectId: "proj-a",
        projectName: "Project A",
        statuses: {
          backlog: 0,
          ready: 0,
          in_progress: 0,
          needs_input: 0,
          done: 0,
          cancelled: 0,
        },
        total: 0,
      },
    ]);
    expect(stats.recentEvents).toEqual([]);
  });

  test("aggregates velocity, doubt response time, statuses and recent events", async () => {
    const first = await createTask(ctx.app, { title: "First", priority: "high" });
    const second = await createTask(ctx.app, { title: "Second" });

    await patchJson(ctx.app, `/tasks/${first.code}`, { status: "done" });

    const now = Date.now();
    insertEvent(ctx.db, {
      projectId: "proj-a",
      taskId: second.id,
      eventType: "completed",
      oldValue: "ready",
      newValue: "done",
      createdAt: new Date(now - 7 * DAY).toISOString(),
    });

    insertEvent(ctx.db, {
      projectId: "proj-a",
      taskId: first.id,
      eventType: "doubt_opened",
      newValue: "needs_input",
      actor: "opencode",
      createdAt: new Date(now - 120 * MINUTE).toISOString(),
    });
    insertEvent(ctx.db, {
      projectId: "proj-a",
      taskId: first.id,
      eventType: "doubt_resolved",
      actor: "Ty",
      createdAt: new Date(now - 90 * MINUTE).toISOString(),
    });
    insertEvent(ctx.db, {
      projectId: "proj-a",
      taskId: second.id,
      eventType: "doubt_opened",
      newValue: "needs_input",
      actor: "opencode",
      createdAt: new Date(now - 60 * MINUTE).toISOString(),
    });
    insertEvent(ctx.db, {
      projectId: "proj-a",
      taskId: second.id,
      eventType: "doubt_resolved",
      actor: "Ty",
      createdAt: new Date(now - 30 * MINUTE).toISOString(),
    });

    const stats = (await (await getJson(ctx.app, "/stats")).json()) as StatsResponse;

    const currentWeek = isoWeekKey(new Date());
    const previousWeek = isoWeekKey(new Date(now - 7 * DAY));
    const byWeek = new Map(stats.velocity.map((entry) => [entry.week, entry.count]));
    expect(byWeek.get(currentWeek)).toBe(1);
    expect(byWeek.get(previousWeek)).toBe(1);
    expect(stats.velocity).toHaveLength(8);

    expect(stats.doubts.averageMinutes).toBe(30);
    expect(stats.doubts.resolvedCount).toBe(2);
    expect(stats.doubts.openCount).toBe(0);

    expect(stats.statusByProject).toHaveLength(1);
    const distribution = stats.statusByProject[0];
    expect(distribution?.statuses.done).toBe(1);
    expect(distribution?.statuses.backlog).toBe(1);
    expect(distribution?.total).toBe(2);

    expect(stats.recentEvents.length).toBeGreaterThan(0);
    const completedEvents = stats.recentEvents.filter((event) => event.eventType === "completed");
    expect(completedEvents.length).toBeGreaterThan(0);
    for (const event of stats.recentEvents) {
      expect(event.projectName).toBe("Project A");
      expect(event.taskCode === first.code || event.taskCode === second.code).toBe(true);
    }
    const timestamps = stats.recentEvents.map((event) => event.createdAt);
    expect([...timestamps].sort().reverse()).toEqual(timestamps);
  });

  test("limits recent events to 20 and ignores unmatched doubt events", async () => {
    const task = await createTask(ctx.app, { title: "Noisy" });

    for (let index = 0; index < 25; index += 1) {
      insertEvent(ctx.db, {
        projectId: "proj-a",
        taskId: task.id,
        eventType: "status_changed",
        oldValue: "ready",
        newValue: "in_progress",
        createdAt: new Date(Date.now() - (25 - index) * MINUTE).toISOString(),
      });
    }

    insertEvent(ctx.db, {
      projectId: "proj-a",
      taskId: task.id,
      eventType: "doubt_resolved",
      createdAt: new Date().toISOString(),
    });

    const stats = (await (await getJson(ctx.app, "/stats")).json()) as StatsResponse;
    expect(stats.recentEvents).toHaveLength(20);
    expect(stats.doubts.averageMinutes).toBeNull();
    expect(stats.doubts.resolvedCount).toBe(0);
    expect(stats.velocity).toHaveLength(8);
    expect(stats.velocity.every((entry) => entry.count === 0)).toBe(true);
  });

  test("counts open doubts across projects", async () => {
    insertProject(ctx.db, { id: "proj-b", codePrefix: "PRB", name: "Project B", relPath: "project-b" });
    const taskA = await createTask(ctx.app, { title: "A" });
    const taskB = await createTask(ctx.app, { title: "B" }, "proj-b");

    for (const code of [taskA.code, taskB.code]) {
      await ctx.app.request(`/api/v1/tasks/${code}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorType: "agent",
          authorName: "opencode",
          kind: "doubt",
          body: "question",
        }),
      });
    }

    const stats = (await (await getJson(ctx.app, "/stats")).json()) as StatsResponse;
    expect(stats.doubts.openCount).toBe(2);
    expect(stats.statusByProject.map((project) => project.projectId)).toEqual(["proj-a", "proj-b"]);
    expect(stats.statusByProject[0]?.statuses.needs_input).toBe(1);
  });
});
