import type { Priority, Status } from "@v3rne/shared";

export interface StatusMeta {
  label: string;
  className: string;
}

export const STATUS_ORDER: readonly Status[] = [
  "backlog",
  "ready",
  "in_progress",
  "needs_input",
  "done",
  "cancelled",
];

/** Stickers use English labels by design; only the surrounding UI is Polish. */
export const STATUS_META: Record<Status, StatusMeta> = {
  backlog: { label: "Backlog", className: "bg-slate-800 text-slate-300 border-slate-700" },
  ready: { label: "Ready", className: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  in_progress: {
    label: "In Progress",
    className: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  },
  needs_input: {
    label: "Needs Input",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  },
  done: { label: "Done", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  cancelled: {
    label: "Cancelled",
    className: "bg-surface-800 text-slate-500 border-slate-700",
  },
};

/** Kanban shows only the active flow; Backlog and Cancelled live in list view and filters. */
export const KANBAN_STATUSES: readonly Status[] = ["ready", "in_progress", "needs_input", "done"];

export function isKanbanStatus(status: Status): boolean {
  return KANBAN_STATUSES.includes(status);
}

export interface PriorityMeta {
  label: string;
  dotClassName: string;
  textClassName: string;
}

export const PRIORITY_META: Record<Priority, PriorityMeta> = {
  urgent: { label: "Urgent", dotClassName: "bg-rose-500", textClassName: "text-rose-400" },
  high: { label: "High", dotClassName: "bg-amber-400", textClassName: "text-amber-300" },
  medium: { label: "Medium", dotClassName: "bg-sky-400", textClassName: "text-sky-300" },
  low: { label: "Low", dotClassName: "bg-slate-500", textClassName: "text-slate-400" },
};

/** Lower value means higher urgency; matches the server's `priority DESC` ordering. */
export const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function comparePriority(a: Priority, b: Priority): number {
  return PRIORITY_RANK[a] - PRIORITY_RANK[b];
}
