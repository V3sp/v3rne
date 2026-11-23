import { formatRelativeTime } from "./format";

/** How often the radar refreshes quietly while the tab is visible. */
export const RADAR_POLL_INTERVAL_MS = 60_000;

/** A resumed tab refreshes at once when at least one full interval has passed since the last run. */
export function isPollDue(lastRunAt: number, now: number, intervalMs: number): boolean {
  return now - lastRunAt >= intervalMs;
}

/** Example: "12:34 · przed chwilą". The clock part is the absolute time, the rest is relative. */
export function formatSyncLabel(lastSyncedAt: string | null, now: Date = new Date()): string {
  if (lastSyncedAt === null) return "—";
  const date = new Date(lastSyncedAt);
  if (Number.isNaN(date.getTime())) return "—";
  const clock = date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  return `${clock} · ${formatRelativeTime(lastSyncedAt, now)}`;
}
