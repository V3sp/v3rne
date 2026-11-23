import { Fragment, useMemo, useRef, useState, type DragEvent } from "react";
import type { Status, Task } from "@v3rne/shared";
import { describeError } from "../../api/client";
import { fetchProjectTasks } from "../../api/projects";
import { useToast } from "../../components/Toasts";
import { formatRelativeTime, pluralizePl } from "../../lib/format";
import { PRIORITY_META, STATUS_META } from "../../lib/status";
import { updateTask } from "./api";
import {
  insertionIndexAfterRemoval,
  kanbanColumns,
  planKanbanMove,
  tasksSignature,
  type KanbanDropTarget,
  type KanbanTaskPatch,
} from "./kanbanDnd";
import { KANBAN_COLUMNS, type KanbanStatus } from "./model";
import { EmptyBox } from "./primitives";

interface TaskBoardProps {
  tasks: Task[];
  commitCounts: ReadonlyMap<string, number>;
  onOpenTask: (code: string) => void;
  /** Called after a successful Kanban move so the parent can reload the task list. */
  onChanged?: () => void;
}

export function TaskList({ tasks, commitCounts, onOpenTask, emptyMessage }: TaskBoardProps & { emptyMessage: string }) {
  if (tasks.length === 0) return <EmptyBox>{emptyMessage}</EmptyBox>;

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          commitCount={commitCounts.get(task.code) ?? 0}
          onOpen={onOpenTask}
        />
      ))}
    </div>
  );
}

function TaskRow({ task, commitCount, onOpen }: { task: Task; commitCount: number; onOpen: (code: string) => void }) {
  const status = STATUS_META[task.status];
  const priority = PRIORITY_META[task.priority];

  return (
    <button
      type="button"
      onClick={() => onOpen(task.code)}
      className="flex w-full items-start justify-between gap-4 rounded-xl border border-slate-800 bg-surface-950/60 p-3.5 text-left transition hover:border-slate-700 hover:bg-surface-850"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold text-indigo-400">{task.code}</span>
          <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${status.className}`}>
            {status.label}
          </span>
          <span className={`flex items-center gap-1 text-[11px] ${priority.textClassName}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${priority.dotClassName}`} />
            {priority.label}
          </span>
          {task.claimedBy && <span className="font-mono text-[11px] text-slate-500">@{task.claimedBy}</span>}
        </span>
        <span className="mt-1 block text-sm font-medium text-slate-100">{task.title}</span>
        {task.planSection && (
          <span className="mt-0.5 block truncate text-[11px] text-slate-500">↳ {task.planSection}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5 text-[11px] text-slate-500">
        <span>{formatRelativeTime(task.updatedAt)}</span>
        {commitCount > 0 && (
          <span className="font-mono text-emerald-400/80">
            {commitCount} {pluralizePl(commitCount, "commit", "commity", "commitów")}
          </span>
        )}
      </span>
    </button>
  );
}

function patchBody(patch: KanbanTaskPatch): { status?: Status; sortOrder?: number } {
  const body: { status?: Status; sortOrder?: number } = {};
  if (patch.status !== undefined) body.status = patch.status;
  if (patch.sortOrder !== undefined) body.sortOrder = patch.sortOrder;
  return body;
}

type DropSlot = { status: KanbanStatus; gap: number };

export function TaskKanban({ tasks, commitCounts, onOpenTask, onChanged }: TaskBoardProps) {
  const showToast = useToast();
  /** Local board that makes a drop visible before the server answers; dropped once fresh props arrive. */
  const [optimistic, setOptimistic] = useState<{ signature: string; tasks: Task[] } | null>(null);
  const [dragging, setDragging] = useState<{ code: string } | null>(null);
  /** Gap index in the rendered column (the dragged card is still counted here). */
  const [dropSlot, setDropSlot] = useState<DropSlot | null>(null);
  const mutationRef = useRef(0);

  const signature = tasksSignature(tasks);
  const board = optimistic !== null && optimistic.signature === signature ? optimistic.tasks : tasks;
  const groups = useMemo(() => kanbanColumns(board), [board]);

  const resetDrag = () => {
    setDragging(null);
    setDropSlot(null);
  };

  const handleDragStart = (event: DragEvent<HTMLElement>, task: Task) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.code);
    setDragging({ code: task.code });
  };

  const handleCardDragOver = (
    event: DragEvent<HTMLElement>,
    status: KanbanStatus,
    index: number,
  ) => {
    if (!dragging) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const gap = index + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
    setDropSlot({ status, gap });
  };

  const handleColumnDragOver = (
    event: DragEvent<HTMLElement>,
    status: KanbanStatus,
    columnCodes: readonly string[],
  ) => {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropSlot({ status, gap: columnCodes.length });
  };

  const handleColumnDragLeave = (event: DragEvent<HTMLElement>, status: KanbanStatus) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropSlot((current) => (current?.status === status ? null : current));
  };

  const applyMove = async (code: string, target: KanbanDropTarget) => {
    const before = board;
    const plan = planKanbanMove(before, code, target);
    if (plan.patches.length === 0) return;

    const mutationId = ++mutationRef.current;
    setOptimistic({ signature: tasksSignature(plan.nextTasks), tasks: plan.nextTasks });
    try {
      await Promise.all(plan.patches.map((patch) => updateTask(patch.code, patchBody(patch))));
      if (mutationId !== mutationRef.current) return;
      if (onChanged) {
        onChanged();
        return;
      }
      // Fallback for parents that do not pass `onChanged`: refresh the board on our own.
      const projectId = plan.nextTasks[0]?.projectId;
      if (!projectId) return;
      const fresh = await fetchProjectTasks(projectId);
      if (mutationId === mutationRef.current) {
        setOptimistic({ signature: tasksSignature(fresh), tasks: fresh });
      }
    } catch (err) {
      if (mutationId !== mutationRef.current) return;
      setOptimistic(null);
      showToast(describeError(err), "warn");
    }
  };

  const handleDrop = (
    event: DragEvent<HTMLElement>,
    status: KanbanStatus,
    columnCodes: readonly string[],
  ) => {
    event.preventDefault();
    const code = dragging?.code;
    const gap = dropSlot?.status === status ? dropSlot.gap : columnCodes.length;
    resetDrag();
    if (!code) return;
    const target: KanbanDropTarget = {
      status,
      index: insertionIndexAfterRemoval(columnCodes, code, gap),
    };
    void applyMove(code, target);
  };

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {KANBAN_COLUMNS.map((status) => {
        const columnTasks = groups[status];
        const columnCodes = columnTasks.map((task) => task.code);
        const dropIndex = dropSlot?.status === status ? dropSlot.gap : null;
        const active = dropIndex !== null;
        return (
          <div
            key={status}
            onDragOver={(event) => handleColumnDragOver(event, status, columnCodes)}
            onDragLeave={(event) => handleColumnDragLeave(event, status)}
            onDrop={(event) => handleDrop(event, status, columnCodes)}
            className={`flex flex-col rounded-lg border p-2.5 transition ${
              active ? "border-indigo-500/60 bg-indigo-500/5" : "border-slate-800/80 bg-surface-950/60"
            }`}
          >
            <div className="mb-2.5 flex items-center justify-between px-1">
              <span
                className={`text-[11px] font-semibold uppercase tracking-wider ${
                  active ? "text-indigo-300" : "text-slate-400"
                }`}
              >
                {STATUS_META[status].label}
              </span>
              <span className="font-mono text-[11px] text-slate-500">{columnTasks.length}</span>
            </div>
            <div className="space-y-2">
              {columnTasks.map((task, index) => (
                <Fragment key={task.id}>
                  {dropIndex === index && <DropIndicator />}
                  <KanbanCard
                    task={task}
                    commitCount={commitCounts.get(task.code) ?? 0}
                    dragging={dragging?.code === task.code}
                    onOpen={onOpenTask}
                    onDragStart={handleDragStart}
                    onDragEnd={resetDrag}
                    onDragOver={(event) => handleCardDragOver(event, status, index)}
                  />
                </Fragment>
              ))}
              {dropIndex !== null && dropIndex >= columnTasks.length && <DropIndicator />}
              {columnTasks.length === 0 && !active && (
                <p className="rounded-lg border border-dashed border-slate-800 px-2 py-4 text-center text-[11px] text-slate-600">
                  Przeciągnij zadanie tutaj
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DropIndicator() {
  return <div aria-hidden className="h-1 rounded-full bg-indigo-400/80" />;
}

interface KanbanCardProps {
  task: Task;
  commitCount: number;
  dragging: boolean;
  onOpen: (code: string) => void;
  onDragStart: (event: DragEvent<HTMLElement>, task: Task) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
}

function KanbanCard({ task, commitCount, dragging, onOpen, onDragStart, onDragEnd, onDragOver }: KanbanCardProps) {
  const priority = PRIORITY_META[task.priority];

  return (
    <button
      type="button"
      draggable
      title="Przeciągnij, aby zmienić status lub kolejność"
      onClick={() => onOpen(task.code)}
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      className={`block w-full cursor-grab rounded-lg border border-slate-800 bg-surface-900 p-2.5 text-left transition hover:border-indigo-500/40 hover:bg-surface-850 active:cursor-grabbing ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <span className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[11px] text-indigo-400">{task.code}</span>
        <span className={`h-2 w-2 rounded-full ${priority.dotClassName}`} title={priority.label} />
      </span>
      <span className="block text-xs font-medium leading-snug text-slate-100">{task.title}</span>
      <span className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
        <span>{task.claimedBy ? `@${task.claimedBy}` : "nieprzypisane"}</span>
        {commitCount > 0 && (
          <span className="font-mono text-emerald-400/80">
            {commitCount} {pluralizePl(commitCount, "commit", "commity", "commitów")}
          </span>
        )}
      </span>
    </button>
  );
}
