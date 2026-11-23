import type { RadarEntry } from "../lib/radar";
import { countOpenDoubts } from "../lib/radar";
import { formatSyncLabel } from "../lib/poll";
import { MCP_URL, NAV_ITEMS, type View } from "../lib/navigation";
import { Icon } from "./icons";

export type ConnectionState = "loading" | "connected" | "error";

interface SidebarProps {
  view: View;
  activeProjectId: string | null;
  entries: readonly RadarEntry[];
  openDoubts: number;
  connection: ConnectionState;
  lastSyncedAt: string | null;
  syncFailed: boolean;
  onNavigate: (view: View) => void;
  onOpenProject: (projectId: string) => void;
  onCopyMcpUrl: () => void;
}

const CONNECTION_META: Record<ConnectionState, { label: string; className: string }> = {
  loading: { label: "Ładowanie…", className: "text-slate-400" },
  connected: { label: "Połączono", className: "text-emerald-400" },
  error: { label: "Brak połączenia", className: "text-rose-400" },
};

export function Sidebar({
  view,
  activeProjectId,
  entries,
  openDoubts,
  connection,
  lastSyncedAt,
  syncFailed,
  onNavigate,
  onOpenProject,
  onCopyMcpUrl,
}: SidebarProps) {
  const activeEntries = entries.filter((entry) => entry.project.active);
  const connectionMeta = CONNECTION_META[connection];

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-800/80 bg-surface-900">
      <div className="flex h-14 items-center gap-2.5 border-b border-slate-800/80 px-4">
        <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-slate-700/70 bg-surface-950">
          <img src="/brand/v3rne-mark.png" alt="" width={32} height={32} className="h-full w-full object-cover" />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight text-white">V3rne</div>
          <div className="flex items-center gap-1 font-mono text-[11px] text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            RO mount • MCP :4321
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const active = view === item.view;
          const badge = item.view === "inbox" ? openDoubts : 0;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onNavigate(item.view)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition ${
                active
                  ? "border-indigo-500/30 bg-indigo-500/15 text-indigo-300"
                  : "border-transparent text-slate-400 hover:bg-surface-850 hover:text-slate-200"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon
                  name={item.icon}
                  className={`h-4 w-4 ${active ? "text-indigo-400" : "text-slate-500"}`}
                />
                {item.label}
              </span>
              {badge > 0 && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                  {badge}
                </span>
              )}
            </button>
          );
        })}

        <div className="mt-4 border-t border-slate-800/80 pt-4">
          <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Aktywne Repozytoria
          </div>
          <div className="space-y-1">
            {activeEntries.map((entry) => {
              const { project, tasks } = entry;
              const selected = view === "project" && activeProjectId === project.id;
              const doubts = countOpenDoubts(tasks);
              const dirty = project.git !== null && project.git.dirtyFiles > 0;
              const dotClass =
                project.git === null
                  ? "bg-slate-600"
                  : dirty
                    ? "bg-amber-400"
                    : "bg-emerald-400";
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onOpenProject(project.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs transition ${
                    selected
                      ? "bg-surface-800 text-white"
                      : "text-slate-400 hover:bg-surface-850 hover:text-slate-200"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
                    <span className="truncate">{project.name}</span>
                  </span>
                  {doubts > 0 ? (
                    <span className="font-mono text-[10px] text-amber-400">{doubts}?</span>
                  ) : (
                    <span className="font-mono text-[10px] text-slate-500">
                      {project.codePrefix}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="space-y-2 border-t border-slate-800/80 p-3">
        <div className="rounded-lg border border-slate-800 bg-surface-850 p-2.5">
          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
            <span>Poller Gita (:ro)</span>
            <span className={`font-mono ${connectionMeta.className}`}>{connectionMeta.label}</span>
          </div>
          <div className="truncate font-mono text-[11px] text-slate-500">
            {activeEntries.length} aktywnych projektów
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-500">
            <span className="truncate">
              Ostatnio zsynchronizowano: {formatSyncLabel(lastSyncedAt)}
            </span>
            {syncFailed && <span className="shrink-0 text-rose-400">błąd</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={onCopyMcpUrl}
          title={MCP_URL}
          className="flex w-full items-center justify-between rounded-md border border-slate-700/70 bg-slate-800/70 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
        >
          <span className="font-mono text-[11px] text-indigo-300">MCP /mcp</span>
          <span className="text-[10px] text-slate-400">Kopiuj URL</span>
        </button>
      </div>
    </aside>
  );
}
