import type { Priority, Status } from "@v3rne/shared";
import { PRIORITY_META, STATUS_META, STATUS_ORDER } from "../../lib/status";
import {
  INITIAL_TASK_FILTERS,
  PRIORITY_ORDER,
  hasActiveTaskFilters,
  toggleFilterValue,
  type TaskFilters,
} from "./model";
import { SegmentButton } from "./primitives";

interface TaskFilterBarProps {
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  visibleCount: number;
  totalCount: number;
}

export function TaskFilterBar({ filters, onFiltersChange, visibleCount, totalCount }: TaskFilterBarProps) {
  const update = (patch: Partial<TaskFilters>) => onFiltersChange({ ...filters, ...patch });
  const active = hasActiveTaskFilters(filters);

  return (
    <div className="flex flex-col gap-2.5 border-b border-slate-800/80 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filters.query}
          onChange={(event) => update({ query: event.target.value })}
          placeholder="Szukaj po kodzie, tytule lub opisie…"
          aria-label="Szukaj zadań"
          className="min-w-[220px] flex-1 rounded border border-slate-700 bg-surface-850 px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-600"
        />
        <span className="text-[11px] text-slate-500">
          Wyniki: {visibleCount} z {totalCount}
        </span>
        {active && (
          <button
            type="button"
            onClick={() => onFiltersChange(INITIAL_TASK_FILTERS)}
            className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-600 hover:text-white"
          >
            Wyczyść filtry
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-slate-400">Status</span>
        {STATUS_ORDER.map((status: Status) => (
          <SegmentButton
            key={status}
            active={filters.statuses.includes(status)}
            onClick={() => update({ statuses: toggleFilterValue(filters.statuses, status) })}
          >
            {STATUS_META[status].label}
          </SegmentButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-slate-400">Priorytet</span>
        {PRIORITY_ORDER.map((priority: Priority) => (
          <SegmentButton
            key={priority}
            active={filters.priorities.includes(priority)}
            onClick={() => update({ priorities: toggleFilterValue(filters.priorities, priority) })}
          >
            {PRIORITY_META[priority].label}
          </SegmentButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={filters.onlyWithDoubts}
            onChange={(event) => update({ onlyWithDoubts: event.target.checked })}
            className="accent-indigo-500"
          />
          Tylko z wątpliwością
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={filters.onlyClaimed}
            onChange={(event) => update({ onlyClaimed: event.target.checked })}
            className="accent-indigo-500"
          />
          Tylko przypisane
        </label>
      </div>
    </div>
  );
}
