import type { ProjectWithGit } from "../../api/types";
import { GitChips } from "../../components/ProjectCard";
import { Icon } from "../../components/icons";
import { RefreshProjectButton } from "../../components/RefreshProjectButton";
import { isTouchedFilesTruncated, touchedFilesTruncationLabel } from "../../lib/git-status";

interface ProjectHeaderProps {
  project: ProjectWithGit;
  projects: ProjectWithGit[];
  onSelectProject?: (projectId: string) => void;
  onRefreshed?: () => void;
}

export function ProjectHeader({ project, projects, onSelectProject, onRefreshed }: ProjectHeaderProps) {
  const options = projects.filter((item) => item.active || item.id === project.id);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-surface-900 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Icon name="project" className="h-4 w-4 text-indigo-400" />
        <select
          aria-label="Przełącz projekt"
          value={project.id}
          disabled={!onSelectProject}
          onChange={(event) => onSelectProject?.(event.target.value)}
          className="rounded-md border border-slate-700 bg-surface-850 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-100"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} ({option.codePrefix})
            </option>
          ))}
        </select>
        <span className="truncate font-mono text-[11px] text-slate-500">/{project.relPath}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 [&>*]:mb-0">
        <GitChips git={project.git} worktreesCount={project.git?.worktrees.length ?? 0} />
        <RefreshProjectButton projectId={project.id} projectName={project.name} onRefreshed={onRefreshed} />
      </div>
      {isTouchedFilesTruncated(project.git) && (
        <p className="basis-full text-right text-[11px] text-slate-500">
          {touchedFilesTruncationLabel()}
        </p>
      )}
    </header>
  );
}
