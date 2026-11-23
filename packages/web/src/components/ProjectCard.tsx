import { formatProgressLabel, formatRelativeTime, pluralizePl, summarizeProgress } from "../lib/format";
import { countOpenDoubts, type RadarEntry } from "../lib/radar";
import {
  resolveBranchState,
  shouldShowStaleBadge,
  shouldShowSyncBadge,
  staleBadgeLabel,
} from "../lib/git-status";
import { RefreshProjectButton } from "./RefreshProjectButton";

interface ProjectCardProps {
  entry: RadarEntry;
  onOpen: (projectId: string) => void;
  onRefreshed?: () => void;
}

export function ProjectCard({ entry, onOpen, onRefreshed }: ProjectCardProps) {
  const { project, plan } = entry;
  const tasks = entry.tasks ?? [];
  const progress = summarizeProgress(tasks);
  const doubts = countOpenDoubts(entry.tasks);
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const ready = tasks.filter((task) => task.status === "ready").length;
  const git = project.git;
  const driftFiles = plan?.files.filter((file) => file.driftStatus === "drift").map((file) => file.path) ?? [];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(project.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(project.id);
        }
      }}
      className="group flex cursor-pointer flex-col justify-between rounded-xl border border-slate-800 bg-surface-900 p-5 transition hover:border-indigo-500/40 hover:bg-surface-850 focus:outline-none focus-visible:border-indigo-500/60"
    >
      <div>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-white transition group-hover:text-indigo-300">
                {project.name}
              </h2>
              <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                {project.codePrefix}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">/{project.relPath}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {doubts > 0 && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                {doubts} {pluralizePl(doubts, "wątpliwość", "wątpliwości", "wątpliwości")}
              </span>
            )}
            <RefreshProjectButton
              projectId={project.id}
              projectName={project.name}
              onRefreshed={onRefreshed}
            />
          </div>
        </div>

        <GitChips git={git} worktreesCount={git?.worktrees.length ?? 0} />

        {plan?.drift && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-200">
            <span>
              ⚠ Wykryto zmiany w{" "}
              <strong className="font-mono">{driftFiles.join(", ") || "plan.md"}</strong>
            </span>
            <span className="text-indigo-400 underline">Sprawdź</span>
          </div>
        )}

        <div className="mb-4">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-slate-400">Zadania ({formatProgressLabel(progress)})</span>
            <span className="font-mono text-slate-300">{progress.percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-950">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
            {entry.tasks === null ? (
              <span className="text-rose-300">Nie udało się pobrać zadań</span>
            ) : (
              <>
                <span>
                  W toku: <strong className="text-slate-300">{inProgress}</strong>
                </span>
                <span>
                  Ready: <strong className="text-slate-300">{ready}</strong>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-[11px] text-slate-400">
        {git?.lastCommit ? (
          <>
            <span className="truncate font-mono text-slate-400">
              <span className="text-indigo-400">{git.lastCommit.shortHash}</span>{" "}
              {git.lastCommit.subject}
            </span>
            <span className="shrink-0 text-slate-500">
              {formatRelativeTime(git.lastCommit.date)}
            </span>
          </>
        ) : (
          <span className="text-slate-500">Brak commitów do pokazania</span>
        )}
      </div>
    </div>
  );
}

export function GitChips({ git, worktreesCount }: { git: RadarEntry["project"]["git"]; worktreesCount: number }) {
  if (!git) {
    return <div className="mb-4 text-[11px] text-slate-500">Brak danych Git — użyj „Odśwież Git”.</div>;
  }
  if (git.error) {
    return (
      <div className="mb-4 truncate rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300" title={git.error}>
        Nie można odczytać repozytorium
      </div>
    );
  }

  const branchState = resolveBranchState(git);
  const dirty = git.dirtyFiles > 0;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {branchState.kind === "detached" ? (
        <span
          className="rounded border border-slate-800 px-2 py-0.5 font-mono text-[11px] italic text-slate-500"
          title="Detached HEAD"
        >
          detached
        </span>
      ) : (
        <span className="rounded border border-slate-800 bg-surface-950 px-2 py-0.5 font-mono text-[11px] text-slate-300">
          {branchState.kind === "branch" ? branchState.name : "—"}
        </span>
      )}
      {dirty ? (
        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-300">
          {git.dirtyFiles} dirty
        </span>
      ) : (
        <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-400">
          clean
        </span>
      )}
      {shouldShowSyncBadge(git) && (
        <span className="rounded border border-slate-800 bg-surface-950 px-2 py-0.5 font-mono text-[11px] text-slate-400">
          ↑{git.ahead} ↓{git.behind}
        </span>
      )}
      {worktreesCount > 1 && (
        <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] text-indigo-300">
          {worktreesCount} worktrees
        </span>
      )}
      {shouldShowStaleBadge(git) && (
        <span className="w-full text-[10px] text-slate-500" title={git.lastErrorAt ?? undefined}>
          {staleBadgeLabel(git)}
        </span>
      )}
    </div>
  );
}
