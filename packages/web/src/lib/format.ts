import type { Task } from "@v3rne/shared";

export interface ProgressSummary {
  done: number;
  total: number;
  /** Rounded to a whole percent; 0 when there is nothing to count. */
  percent: number;
}

/** Cancelled tasks are excluded: they can never be completed and would distort progress. */
export function summarizeProgress(tasks: readonly Pick<Task, "status">[]): ProgressSummary {
  const counted = tasks.filter((task) => task.status !== "cancelled");
  const done = counted.filter((task) => task.status === "done").length;
  const total = counted.length;
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

export function formatProgressLabel(progress: ProgressSummary): string {
  return `${progress.done}/${progress.total}`;
}

/** Polish plural: `one` for 1, `few` for 2–4 (except 12–14), `many` otherwise. */
export function pluralizePl(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (count === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Relative Polish timestamp such as "18 min temu"; falls back to a date after a week. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = now.getTime() - date.getTime();
  if (diffMs < MINUTE_MS) return "przed chwilą";
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)} min temu`;

  const dayDiff = calendarDayDiff(now, date);
  if (dayDiff === 0) return `${Math.floor(diffMs / HOUR_MS)} godz. temu`;
  if (dayDiff === 1) return "wczoraj";
  if (dayDiff < 7) return `${dayDiff} dni temu`;
  return date.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function calendarDayDiff(later: Date, earlier: Date): number {
  const laterDay = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const earlierDay = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((laterDay - earlierDay) / (24 * HOUR_MS));
}
