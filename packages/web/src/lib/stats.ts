import type { Status } from "@v3rne/shared";
import { PRIORITY_META, STATUS_META, STATUS_ORDER } from "./status";

export type StatusCounts = Record<Status, number>;

export function emptyStatusCounts(): StatusCounts {
  return Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as StatusCounts;
}

/** Total number of tasks in one project, across every status. */
export function sumStatusCounts(counts: Partial<Record<Status, number>>): number {
  return STATUS_ORDER.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}

/** Sums the per-project status distribution into one count per status. */
export function aggregateStatusTotals(
  rows: readonly { statuses: Partial<Record<Status, number>> }[],
): StatusCounts {
  const totals = emptyStatusCounts();
  for (const row of rows) {
    for (const status of STATUS_ORDER) {
      totals[status] += row.statuses[status] ?? 0;
    }
  }
  return totals;
}

/** Minutes → "26 min", "2 h 5 min", "2 h". */
export function formatDoubtAverage(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "brak danych";
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** True when no week in the velocity series has a completed task (also true for an empty series). */
export function isVelocityEmpty(velocity: readonly { count: number }[]): boolean {
  return velocity.every((point) => point.count === 0);
}

/** "2026-W47" → "Tydz. 47"; unknown formats are returned unchanged. */
export function formatWeekLabel(week: string): string {
  const match = /-W(\d{2})$/.exec(week);
  return match ? `Tydz. ${Number(match[1])}` : week;
}

interface EventLike {
  eventType: string;
  oldValue: string | null;
  newValue: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  created: "Utworzono zadanie",
  doubt_opened: "Zgłoszono wątpliwość",
  doubt_resolved: "Rozwiązano wątpliwość",
  completed: "Ukończono zadanie",
};

export function describeEvent(event: EventLike): string {
  if (event.eventType === "status_changed") {
    return `Status: ${statusLabel(event.oldValue)} → ${statusLabel(event.newValue)}`;
  }
  if (event.eventType === "priority_changed") {
    return `Priorytet: ${priorityLabel(event.oldValue)} → ${priorityLabel(event.newValue)}`;
  }
  return EVENT_LABELS[event.eventType] ?? event.eventType;
}

function statusLabel(value: string | null): string {
  if (value && STATUS_ORDER.includes(value as Status)) return STATUS_META[value as Status].label;
  return value ?? "—";
}

function priorityLabel(value: string | null): string {
  if (value && Object.hasOwn(PRIORITY_META, value)) {
    return PRIORITY_META[value as keyof typeof PRIORITY_META].label;
  }
  return value ?? "—";
}
