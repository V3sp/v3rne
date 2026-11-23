import { useState, type ReactNode } from "react";
import { refreshProjectGit } from "./api/projects";
import { ErrorState, Loader, PlaceholderView } from "./components/StatusViews";
import { NewTaskModal } from "./components/NewTaskModal";
import { RadarView } from "./components/RadarView";
import { Sidebar, type ConnectionState } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { useToast } from "./components/Toasts";
import { useBackgroundPoll } from "./hooks/useBackgroundPoll";
import { useRadarData } from "./hooks/useRadarData";
import { InboxView } from "./views/inbox/InboxView";
import { StatsView } from "./views/stats/StatsView";
import { ProjectView } from "./views/project/ProjectView";
import { MCP_URL, type View } from "./lib/navigation";
import { summarizeRadar, type RadarEntry } from "./lib/radar";
import { RADAR_POLL_INTERVAL_MS } from "./lib/poll";

const VIEW_HEADERS: Record<View, { title: string; subtitle: string }> = {
  radar: {
    title: "Radar Projektów",
    subtitle: "Zbiorczy monitoring lokalnych repozytoriów (:ro)",
  },
  project: { title: "Widok Projektu", subtitle: "Plan, zadania i Kanban" },
  inbox: { title: "Globalny Inbox Wątpliwości", subtitle: "Otwarte pytania agentów" },
  stats: { title: "Statystyki & Konfigurator", subtitle: "Workspace i telemetria" },
};

export function App() {
  const [view, setView] = useState<View>("radar");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [pendingTaskCode, setPendingTaskCode] = useState<string | null>(null);
  /** Bumped on every inbox click so the same task can be reopened after closing the drawer. */
  const [pendingTaskNonce, setPendingTaskNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  /** Bumped after creating a task so the project workspace remounts with fresh tasks. */
  const [projectDataVersion, setProjectDataVersion] = useState(0);
  const { state, reload, reloadSilently, lastSyncedAt, syncFailed } = useRadarData();
  const showToast = useToast();
  useBackgroundPoll(() => void reloadSilently(), RADAR_POLL_INTERVAL_MS);

  const entries: RadarEntry[] = state.status === "ready" ? state.entries : [];
  const openDoubts = summarizeRadar(entries).openDoubts;
  const connection: ConnectionState =
    state.status === "ready" ? "connected" : state.status === "error" ? "error" : "loading";

  const openProject = (projectId: string) => {
    setPendingTaskCode(null);
    setActiveProjectId(projectId);
    setView("project");
  };

  const refreshGit = async () => {
    if (refreshing) return;
    const active = entries.filter((entry) => entry.project.active);
    if (active.length === 0) {
      showToast("Brak aktywnych repozytoriów do odświeżenia", "info");
      return;
    }

    setRefreshing(true);
    const results = await Promise.allSettled(
      active.map((entry) => refreshProjectGit(entry.project.id)),
    );
    await reload();
    setRefreshing(false);

    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed > 0) {
      showToast(`Odświeżono Git z błędami: ${failed} z ${active.length}`, "warn");
    } else {
      showToast(`Odświeżono status Gita (${active.length} repo)`, "success");
    }
  };

  const copyMcpUrl = () => {
    void navigator.clipboard?.writeText(MCP_URL).catch(() => undefined);
    showToast("Skopiowano adres MCP (Streamable HTTP)", "success");
  };

  /** The modal shows its own toast; here we refresh every view that lists tasks. */
  const handleTaskCreated = () => {
    setProjectDataVersion((version) => version + 1);
    void reload();
  };

  const renderContent = (): ReactNode => {
    if (state.status === "loading") return <Loader />;
    if (state.status === "error") {
      return <ErrorState message={state.message} onRetry={() => void reload()} />;
    }

    switch (view) {
      case "radar":
        return (
          <RadarView
            entries={state.entries}
            onOpenProject={openProject}
            onOpenInbox={() => setView("inbox")}
            onProjectRefreshed={() => void reload()}
          />
        );
      case "project":
        return activeProjectId ? (
          <ProjectView
            key={`${activeProjectId}:${projectDataVersion}:${pendingTaskNonce}`}
            projectId={activeProjectId}
            onSelectProject={setActiveProjectId}
            initialTaskCode={pendingTaskCode}
          />
        ) : (
          <PlaceholderView
            title="Widok Projektu"
            description="Wybierz projekt w panelu bocznym, aby zobaczyć plan, zadania i Kanban."
          />
        );
      case "inbox":
        return (
          <InboxView
            onOpenTask={(code, projectId) => {
              setPendingTaskCode(code);
              setPendingTaskNonce((value) => value + 1);
              setActiveProjectId(projectId);
              setView("project");
            }}
            onChanged={() => void reload()}
          />
        );
      case "stats":
        return <StatsView onProjectsChanged={() => void reload()} />;
    }
  };

  const header = VIEW_HEADERS[view];

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        view={view}
        activeProjectId={activeProjectId}
        entries={entries}
        openDoubts={openDoubts}
        connection={connection}
        lastSyncedAt={lastSyncedAt}
        syncFailed={syncFailed}
        onNavigate={setView}
        onOpenProject={openProject}
        onCopyMcpUrl={copyMcpUrl}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          title={header.title}
          subtitle={header.subtitle}
          refreshing={refreshing}
          onRefreshGit={() => void refreshGit()}
          onNewTask={() => setNewTaskOpen(true)}
        />
        <main className="flex-1 overflow-y-auto p-6">{renderContent()}</main>
      </div>

      <NewTaskModal
        open={newTaskOpen}
        defaultProjectId={activeProjectId}
        onClose={() => setNewTaskOpen(false)}
        onCreated={handleTaskCreated}
      />
    </div>
  );
}
