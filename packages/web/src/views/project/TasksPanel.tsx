import type { Task } from "@v3rne/shared";
import { emptyTaskMessage, filterTasks, type TaskFilters } from "./model";
import { SegmentButton } from "./primitives";
import { TaskFilterBar } from "./TaskFilterBar";
import { TaskKanban, TaskList } from "./TaskBoards";

export type TasksMode = "list" | "kanban";

interface TasksPanelProps {
  tasks: Task[];
  commitCounts: ReadonlyMap<string, number>;
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  mode: TasksMode;
  onModeChange: (mode: TasksMode) => void;
  onOpenTask: (code: string) => void;
  onTasksChanged?: () => void;
}

export function TasksPanel({
  tasks,
  commitCounts,
  filters,
  onFiltersChange,
  mode,
  onModeChange,
  onOpenTask,
  onTasksChanged,
}: TasksPanelProps) {
  const visible = filterTasks(tasks, filters);

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-surface-900 lg:col-span-7 xl:col-span-8">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white">Zadania projektu</h2>
          {filters.planSection !== null && (
            <span className="flex max-w-[280px] items-center gap-1.5 rounded bg-indigo-500/15 py-0.5 pl-2 pr-1 text-[11px] text-indigo-300">
              <span className="truncate">Filtr: {filters.planSection}</span>
              <button
                type="button"
                aria-label="Usuń filtr sekcji"
                onClick={() => onFiltersChange({ ...filters, planSection: null })}
                className="shrink-0 px-1 text-indigo-200 hover:text-white"
              >
                ×
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-surface-950 p-0.5">
          <SegmentButton active={mode === "list"} onClick={() => onModeChange("list")}>
            Lista priorytetów
          </SegmentButton>
          <SegmentButton active={mode === "kanban"} onClick={() => onModeChange("kanban")}>
            Kanban
          </SegmentButton>
        </div>
      </div>

      <TaskFilterBar
        filters={filters}
        onFiltersChange={onFiltersChange}
        visibleCount={visible.length}
        totalCount={tasks.length}
      />

      <div className="p-4">
        {mode === "list" ? (
          <TaskList
            tasks={visible}
            commitCounts={commitCounts}
            onOpenTask={onOpenTask}
            emptyMessage={emptyTaskMessage(tasks.length, filters)}
          />
        ) : (
          <TaskKanban
            tasks={visible}
            commitCounts={commitCounts}
            onOpenTask={onOpenTask}
            onChanged={onTasksChanged}
          />
        )}
      </div>
    </section>
  );
}
