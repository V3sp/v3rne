import type { Status, Task } from "@v3rne/shared";
import { comparePriority } from "../../lib/status";
import { groupTasksByKanbanColumn, isKanbanColumn, KANBAN_COLUMNS, type KanbanStatus } from "./model";

/** Minimal PATCH body for one task; only fields that actually differ from the current row. */
export interface KanbanTaskPatch {
  code: string;
  status?: Status;
  sortOrder?: number;
}

export interface KanbanDropTarget {
  status: KanbanStatus;
  /** Insert index inside the target column, counted after the dragged card is removed. */
  index: number;
}

export interface KanbanMovePlan {
  /** List with the optimistic position applied; equal to the input when nothing changed. */
  nextTasks: Task[];
  patches: KanbanTaskPatch[];
  statusChanged: boolean;
}

/**
 * Manual `sortOrder` wins, priority and id only break ties: fresh tasks all start at
 * `sortOrder = 0`, so the board keeps its priority order until someone drags a card.
 */
export function sortKanbanTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) => a.sortOrder - b.sortOrder || comparePriority(a.priority, b.priority) || a.id - b.id,
  );
}

/** Kanban columns with their cards in drag order; Backlog and Cancelled never appear. */
export function kanbanColumns(tasks: readonly Task[]): Record<KanbanStatus, Task[]> {
  const groups = groupTasksByKanbanColumn(tasks);
  const columns = {} as Record<KanbanStatus, Task[]>;
  for (const status of KANBAN_COLUMNS) columns[status] = sortKanbanTasks(groups[status]);
  return columns;
}

/**
 * Content fingerprint of the task list. The parent rebuilds the array on every render,
 * so identity says nothing; only a real content change should drop the optimistic board.
 */
export function tasksSignature(tasks: readonly Task[]): string {
  return tasks
    .map((task) => `${task.code}:${task.status}:${task.sortOrder}:${task.updatedAt}`)
    .join("|");
}

export function isStatusChange(task: Task, status: KanbanStatus): boolean {
  return task.status !== status;
}

/**
 * A card hovered over the column is an index in the visible list, which still contains the
 * dragged card when the drop stays in the same column. Removing it shifts later slots left.
 */
export function insertionIndexAfterRemoval(
  columnCodes: readonly string[],
  code: string,
  rawIndex: number,
): number {
  const clamped = Math.min(Math.max(rawIndex, 0), columnCodes.length);
  const from = columnCodes.indexOf(code);
  if (from === -1) return clamped;
  return clamped > from ? clamped - 1 : clamped;
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length);
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((code, position) => code === b[position]);
}

/**
 * Turns a drop into the optimistic list plus the PATCH bodies to send.
 * The target column is renumbered 0..n-1 only when the visible order changes, so a drop
 * in place sends nothing and untouched columns are never rewritten.
 */
export function planKanbanMove(
  tasks: readonly Task[],
  code: string,
  target: KanbanDropTarget,
): KanbanMovePlan {
  const dragged = tasks.find((task) => task.code === code);
  if (!dragged || !isKanbanColumn(dragged.status)) {
    return { nextTasks: [...tasks], patches: [], statusChanged: false };
  }

  const columns = kanbanColumns(tasks);
  const statusChanged = isStatusChange(dragged, target.status);
  const orderBefore = columns[target.status].map((task) => task.code);
  const targetColumn = columns[target.status].filter((task) => task.code !== code);
  targetColumn.splice(clampIndex(target.index, targetColumn.length), 0, dragged);

  const orderChanged = !sameOrder(orderBefore, targetColumn.map((task) => task.code));
  if (!statusChanged && !orderChanged) {
    return { nextTasks: [...tasks], patches: [], statusChanged };
  }

  const patches: KanbanTaskPatch[] = [];
  const updates = new Map<string, Pick<Task, "status" | "sortOrder">>();

  targetColumn.forEach((task, position) => {
    const patch: KanbanTaskPatch = { code: task.code };
    if (statusChanged && task.code === code) patch.status = target.status;
    if (orderChanged && task.sortOrder !== position) patch.sortOrder = position;
    if (patch.status === undefined && patch.sortOrder === undefined) return;
    patches.push(patch);
    updates.set(task.code, updateFor(task, patch));
  });

  const nextTasks = tasks.map((task) => {
    const update = updates.get(task.code);
    return update ? { ...task, ...update } : task;
  });

  return { nextTasks, patches, statusChanged };
}

function updateFor(task: Task, patch: KanbanTaskPatch): Pick<Task, "status" | "sortOrder"> {
  return {
    status: patch.status ?? task.status,
    sortOrder: patch.sortOrder ?? task.sortOrder,
  };
}
