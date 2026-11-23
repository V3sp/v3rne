import { Icon } from "./icons";

interface TopbarProps {
  title: string;
  subtitle: string;
  refreshing: boolean;
  onRefreshGit: () => void;
  onNewTask: () => void;
}

export function Topbar({ title, subtitle, refreshing, onRefreshGit, onNewTask }: TopbarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800/80 bg-surface-900/90 px-6 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-sm font-semibold text-white">{title}</h1>
        <span className="truncate text-xs text-slate-500">{subtitle}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onRefreshGit}
          disabled={refreshing}
          title="Odśwież status Gita dla aktywnych repozytoriów"
          className="flex items-center gap-1.5 rounded-md border border-slate-700/70 bg-surface-850 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-surface-800 disabled:cursor-wait disabled:opacity-60"
        >
          <Icon
            name="refresh"
            className={`h-3.5 w-3.5 text-slate-400 ${refreshing ? "animate-spin" : ""}`}
          />
          Odśwież Git
        </button>
        <button
          type="button"
          onClick={onNewTask}
          aria-haspopup="dialog"
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-indigo-500/20 transition hover:bg-indigo-500"
        >
          <Icon name="plus" className="h-3.5 w-3.5" strokeWidth={2.5} />
          Nowe zadanie
        </button>
      </div>
    </header>
  );
}
