import { useEffect, useState } from "react";
import { describeError } from "../../api/client";
import { ErrorState, Loader } from "../../components/StatusViews";
import { useToast } from "../../components/Toasts";
import { useProjectWorkspace } from "../../hooks/useProjectWorkspace";
import { DocsTab, PlanTab } from "./PlanTabs";
import { ProjectHeader } from "./ProjectHeader";
import { TaskDrawer } from "./TaskDrawer";
import { TasksPanel, type TasksMode } from "./TasksPanel";
import { INITIAL_TASK_FILTERS, countCommitsByTask, snapshotCommits, type TaskFilters } from "./model";
import { TabButton } from "./primitives";

export interface ProjectViewProps {
  projectId: string;
  /** Switches the project from the header selector; omit to render the selector as read-only. */
  onSelectProject?: (projectId: string) => void;
  /** Opens the drawer for this task code, e.g. when arriving from the doubts inbox. */
  initialTaskCode?: string | null;
}

type LeftTab = "plan" | "docs";

/** Keyed by project so switching projects starts with fresh filters, tab and drawer state. */
export function ProjectView(props: ProjectViewProps) {
  return <ProjectWorkspace key={props.projectId} {...props} />;
}

function ProjectWorkspace({ projectId, onSelectProject, initialTaskCode }: ProjectViewProps) {
  const { state, reload, refreshTasks, refreshProjects, acknowledgeDrift } = useProjectWorkspace(projectId);
  const showToast = useToast();
  const [leftTab, setLeftTab] = useState<LeftTab>("plan");
  const [mode, setMode] = useState<TasksMode>("list");
  const [filters, setFilters] = useState<TaskFilters>(INITIAL_TASK_FILTERS);
  const [openTaskCode, setOpenTaskCode] = useState<string | null>(initialTaskCode ?? null);

  useEffect(() => {
    if (initialTaskCode) setOpenTaskCode(initialTaskCode);
  }, [initialTaskCode]);

  if (state.status === "loading") return <Loader />;
  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={() => void reload()} />;
  }

  const { data } = state;
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) {
    return (
      <ErrorState
        message={`Projekt „${projectId}” nie istnieje w V3rne.`}
        onRetry={() => void reload()}
      />
    );
  }

  const commits = snapshotCommits(project.git);
  const commitCounts = countCommitsByTask(commits);

  const acknowledge = async () => {
    try {
      await acknowledgeDrift();
      showToast("Zatwierdzono bieżący stan plan.md", "success");
    } catch (err) {
      showToast(describeError(err), "warn");
    }
  };

  const syncTasks = () => {
    refreshTasks().catch((err: unknown) => showToast(describeError(err), "warn"));
  };

  return (
    <div className="flex animate-fade flex-col gap-5">
      <ProjectHeader
        project={project}
        projects={data.projects}
        onSelectProject={onSelectProject}
        onRefreshed={() => refreshProjects().catch(() => undefined)}
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <section className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-surface-900 lg:col-span-5 xl:col-span-4">
          <div role="tablist" className="flex items-center gap-1 border-b border-slate-800 px-3 pt-3">
            <TabButton active={leftTab === "plan"} onClick={() => setLeftTab("plan")}>
              Plan ({project.planFiles[0] ?? "brak pliku"})
            </TabButton>
            <TabButton active={leftTab === "docs"} onClick={() => setLeftTab("docs")}>
              Agent Docs ({project.agentDocs.length})
            </TabButton>
          </div>
          <div className="p-4">
            {leftTab === "plan" ? (
              <PlanTab
                projectId={project.id}
                projectName={project.name}
                plan={data.plan}
                planError={data.planError}
                tasks={data.tasks}
                selectedSection={filters.planSection}
                onSelectSection={(title) => setFilters((current) => ({ ...current, planSection: title }))}
                onAcknowledgeDrift={() => void acknowledge()}
              />
            ) : (
              <DocsTab docs={data.docs} docsError={data.docsError} />
            )}
          </div>
        </section>

        <TasksPanel
          tasks={data.tasks}
          commitCounts={commitCounts}
          filters={filters}
          onFiltersChange={setFilters}
          mode={mode}
          onModeChange={setMode}
          onOpenTask={setOpenTaskCode}
          onTasksChanged={syncTasks}
        />
      </div>

      {openTaskCode !== null && (
        <TaskDrawer
          key={openTaskCode}
          code={openTaskCode}
          projectName={project.name}
          commits={commits}
          onClose={() => setOpenTaskCode(null)}
          onChanged={syncTasks}
        />
      )}
    </div>
  );
}

