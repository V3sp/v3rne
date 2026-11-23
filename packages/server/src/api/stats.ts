import { Hono } from "hono";
import { StatusSchema, type Status } from "@v3rne/shared";
import { toErrorResponse, type ApiDeps } from "./tasks";

const VELOCITY_WEEKS = 8;
const RECENT_EVENTS_LIMIT = 20;
const MS_PER_DAY = 86_400_000;

interface CompletedRow {
  created_at: string;
}

interface DoubtEventRow {
  task_id: number;
  event_type: string;
  created_at: string;
}

interface StatusCountRow {
  project_id: string;
  status: string;
  count: number;
}

interface ProjectRow {
  id: string;
  name: string;
}

interface RecentEventRow {
  id: number;
  project_id: string;
  project_name: string;
  task_id: number;
  task_code: string;
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  actor: string;
  created_at: string;
}

const ALL_STATUSES = StatusSchema.options;

export function createStatsRouter(deps: ApiDeps): Hono {
  const { db } = deps;
  const app = new Hono();

  app.get("/stats", (c) => {
    try {
      const now = new Date();

      const completed = db
        .query<CompletedRow, []>(
          "SELECT created_at FROM task_events WHERE event_type = 'completed' ORDER BY created_at ASC",
        )
        .all();
      const weekKeys = lastIsoWeeks(now, VELOCITY_WEEKS);
      const countsByWeek = new Map<string, number>(weekKeys.map((week) => [week, 0]));
      for (const row of completed) {
        const key = isoWeekKey(new Date(row.created_at));
        const current = countsByWeek.get(key);
        if (current !== undefined) countsByWeek.set(key, current + 1);
      }
      const velocity = weekKeys.map((week) => ({ week, count: countsByWeek.get(week) ?? 0 }));

      const doubtEvents = db
        .query<DoubtEventRow, []>(
          `SELECT task_id, event_type, created_at FROM task_events
           WHERE event_type IN ('doubt_opened', 'doubt_resolved')
           ORDER BY task_id ASC, created_at ASC, id ASC`,
        )
        .all();
      const durations = pairDoubtDurations(doubtEvents);
      const averageMinutes =
        durations.length === 0
          ? null
          : Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 100) / 100;

      const openDoubts = db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM comments WHERE kind = 'doubt' AND is_resolved = 0",
        )
        .get();

      const projects = db
        .query<ProjectRow, []>("SELECT id, name FROM projects ORDER BY name ASC")
        .all();
      const statusCounts = db
        .query<StatusCountRow, []>(
          "SELECT project_id, status, COUNT(*) AS count FROM tasks GROUP BY project_id, status",
        )
        .all();
      const statusByProject = projects.map((project) => {
        const statuses = Object.fromEntries(ALL_STATUSES.map((status) => [status, 0])) as Record<Status, number>;
        let total = 0;
        for (const row of statusCounts) {
          if (row.project_id !== project.id) continue;
          if (!(ALL_STATUSES as readonly string[]).includes(row.status)) continue;
          statuses[row.status as Status] = row.count;
          total += row.count;
        }
        return { projectId: project.id, projectName: project.name, statuses, total };
      });

      const recentEvents = db
        .query<RecentEventRow, []>(
          `SELECT e.id, e.project_id, p.name AS project_name, e.task_id, t.code AS task_code,
                  e.event_type, e.old_value, e.new_value, e.actor, e.created_at
           FROM task_events e
           JOIN tasks t ON t.id = e.task_id
           JOIN projects p ON p.id = e.project_id
           ORDER BY e.created_at DESC, e.id DESC
           LIMIT ${RECENT_EVENTS_LIMIT}`,
        )
        .all()
        .map((row) => ({
          id: row.id,
          projectId: row.project_id,
          projectName: row.project_name,
          taskId: row.task_id,
          taskCode: row.task_code,
          eventType: row.event_type,
          oldValue: row.old_value,
          newValue: row.new_value,
          actor: row.actor,
          createdAt: row.created_at,
        }));

      return c.json({
        generatedAt: now.toISOString(),
        velocity,
        doubts: {
          averageMinutes,
          resolvedCount: durations.length,
          openCount: openDoubts?.count ?? 0,
        },
        statusByProject,
        recentEvents,
      });
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  return app;
}

/** ISO-8601 week key, e.g. `2026-W47`. */
export function isoWeekKey(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayOfWeek);
  const isoYear = utc.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((utc.getTime() - yearStart) / MS_PER_DAY + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Ascending list of the last `count` ISO weeks, current week last. */
export function lastIsoWeeks(now: Date, count: number): string[] {
  const weeks: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    weeks.push(isoWeekKey(new Date(now.getTime() - offset * 7 * MS_PER_DAY)));
  }
  return weeks;
}

/**
 * Pairs `doubt_opened` with the next `doubt_resolved` per task, in event order.
 * Returns the durations in minutes.
 */
function pairDoubtDurations(events: DoubtEventRow[]): number[] {
  const pending = new Map<number, string[]>();
  const durations: number[] = [];

  for (const event of events) {
    const queue = pending.get(event.task_id) ?? [];
    if (event.event_type === "doubt_opened") {
      queue.push(event.created_at);
      pending.set(event.task_id, queue);
      continue;
    }
    const openedAt = queue.shift();
    pending.set(event.task_id, queue);
    if (!openedAt) continue;
    const minutes = (Date.parse(event.created_at) - Date.parse(openedAt)) / 60_000;
    if (Number.isFinite(minutes) && minutes >= 0) durations.push(minutes);
  }

  return durations;
}
