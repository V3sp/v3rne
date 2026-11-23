import { useState, type ReactNode } from "react";
import { registerDiscoveredRepo, scanWorkspace, setProjectActive, type DiscoveredRepo } from "../../api/config";
import { refreshProjectGit } from "../../api/projects";
import { describeError } from "../../api/client";
import type { ProjectWithGit } from "../../api/types";
import { useConfigProjects } from "../../hooks/useConfigProjects";
import { pluralizePl } from "../../lib/format";
import { buildConfigPreview, planDirsBadge } from "../../lib/config";
import { MCP_URL } from "../../lib/navigation";
import { Icon } from "../../components/icons";
import { ProjectEditModal } from "../../components/ProjectEditModal";
import { ErrorState, Loader } from "../../components/StatusViews";
import { useToast } from "../../components/Toasts";

interface ConfigViewProps {
  /** Called after a project is toggled so the app can refresh the sidebar and radar. */
  onChanged?: () => void;
}

type ScanState =
  | { phase: "idle" | "scanning"; repos: DiscoveredRepo[]; message: string }
  | { phase: "done"; repos: DiscoveredRepo[]; message: string }
  | { phase: "error"; repos: DiscoveredRepo[]; message: string };

export function ConfigView({ onChanged }: ConfigViewProps) {
  const { state, reload } = useConfigProjects();
  const showToast = useToast();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [registering, setRegistering] = useState<ReadonlySet<string>>(() => new Set());
  const [scan, setScan] = useState<ScanState>({ phase: "idle", repos: [], message: "" });
  const [editing, setEditing] = useState<ProjectWithGit | null>(null);

  if (state.status === "loading") return <Loader label="Ładowanie konfiguracji…" />;
  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={() => void reload()} />;
  }

  const projects = state.data;

  const toggleActive = async (project: ProjectWithGit) => {
    setPending((current) => new Set(current).add(project.id));
    try {
      await setProjectActive(project.id, !project.active);
      showToast(
        `${project.name}: ${project.active ? "monitoring wyłączony" : "monitoring włączony"}`,
        "success",
      );
      await reload();
      onChanged?.();
    } catch (err) {
      showToast(describeError(err), "warn");
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
    }
  };

  const saveProject = async (saved: { name: string }) => {
    setEditing(null);
    showToast(`Zapisano ${saved.name}`, "success");
    await reload();
    onChanged?.();
  };

  const runScan = async () => {
    setScan({ phase: "scanning", repos: [], message: "" });
    try {
      const repos = await scanWorkspace();
      setScan({ phase: "done", repos, message: "" });
    } catch (err) {
      setScan({ phase: "error", repos: [], message: describeError(err) });
    }
  };

  const registerRepo = async (repo: DiscoveredRepo) => {
    setRegistering((current) => new Set(current).add(repo.relPath));
    try {
      const project = await registerDiscoveredRepo({ name: repo.name, relPath: repo.relPath });
      showToast(`Dodano ${project.name} (${project.codePrefix}) do monitoringu`, "success");
      // Pierwszy snapshot od razu, żeby karta projektu nie czekała na poller.
      void refreshProjectGit(project.id).catch(() => undefined);
      await reload();
      onChanged?.();
      setScan((current) => ({
        ...current,
        repos: current.repos.map((item) =>
          item.relPath === repo.relPath ? { ...item, alreadyRegistered: true } : item,
        ),
      }));
    } catch (err) {
      showToast(describeError(err), "warn");
    } finally {
      setRegistering((current) => {
        const next = new Set(current);
        next.delete(repo.relPath);
        return next;
      });
    }
  };

  const copyMcpUrl = () => {
    void navigator.clipboard?.writeText(MCP_URL).catch(() => undefined);
    showToast("Skopiowano adres MCP (Streamable HTTP)", "success");
  };

  return (
    <div className="grid grid-cols-1 gap-5 animate-fade lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-7">
        <Card title="Projekty" subtitle="Wyłączony projekt przestaje być monitorowany przez poller Gita.">
          {projects.length === 0 ? (
            <p className="text-xs text-slate-500">
              Brak projektów. Uruchom skaner poniżej i dodaj repozytorium do monitoringu.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-surface-950/70 p-3.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-semibold text-white">{project.name}</span>
                      <span className="shrink-0 font-mono text-[10px] text-slate-500">
                        /{project.relPath}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-400">
                      <span className="truncate">Katalogi: {project.planDirs.join(", ") || "—"}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 font-sans text-[10px] ${
                          project.planDirsOverride
                            ? "border-indigo-500/30 bg-indigo-500/15 text-indigo-200"
                            : "border-slate-700 bg-surface-850 text-slate-400"
                        }`}
                      >
                        {planDirsBadge(project)}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-slate-500">
                      Pliki planu: {project.planFiles.join(", ") || "—"} • Docs:{" "}
                      {project.agentDocs.join(", ") || "—"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setEditing(project)}
                      aria-label={`Edytuj ${project.name}`}
                      className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-indigo-500/40 hover:text-white"
                    >
                      Edytuj
                    </button>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={project.active}
                        disabled={pending.has(project.id)}
                        onChange={() => void toggleActive(project)}
                        aria-label={`Monitoruj ${project.name}`}
                        className="h-4 w-4 accent-indigo-500 disabled:cursor-wait"
                      />
                      <span className="text-xs text-slate-300">
                        {project.active ? "Aktywny" : "Wyłączony"}
                      </span>
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Auto-Discovery Repozytoriów"
          subtitle="Skaner szuka katalogów z .git w workspace (tylko odczyt). Repozytorium dodajesz przyciskiem."
          action={
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={scan.phase === "scanning"}
              className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
            >
              {scan.phase === "scanning" ? "Skanowanie…" : "Skanuj workspace"}
            </button>
          }
        >
          <ScanResults scan={scan} registering={registering} onRegister={(repo) => void registerRepo(repo)} />
        </Card>
      </div>

      {editing && (
        <ProjectEditModal
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => void saveProject(saved)}
        />
      )}

      <div className="space-y-5 lg:col-span-5">
        <Card title="Podłączenie Agentów (MCP)">
          <div className="text-xs text-slate-400">Serwer MCP (OpenCode / t3code)</div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-surface-950 p-2.5 font-mono text-[11px] text-indigo-300">
            <span className="truncate">{MCP_URL}</span>
            <button
              type="button"
              onClick={copyMcpUrl}
              className="flex shrink-0 items-center gap-1 text-slate-400 transition hover:text-white"
            >
              <Icon name="copy" className="h-3.5 w-3.5" />
              Kopiuj
            </button>
          </div>
        </Card>

        <Card
          title="Podgląd config.yaml"
          subtitle="Tylko do odczytu — zmiany wykonuj w pliku konfiguracyjnym lub przez przełączniki powyżej."
        >
          <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-surface-950 p-3 font-mono text-[10px] leading-relaxed text-slate-300">
            {buildConfigPreview(projects)}
          </pre>
        </Card>
      </div>
    </div>
  );
}

interface CardProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}

function Card({ title, subtitle, action, children }: CardProps) {
  return (
    <section className="space-y-4 rounded-xl border border-slate-800 bg-surface-900 p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function ScanResults({
  scan,
  registering,
  onRegister,
}: {
  scan: ScanState;
  registering: ReadonlySet<string>;
  onRegister: (repo: DiscoveredRepo) => void;
}) {
  if (scan.phase === "idle") {
    return (
      <p className="text-xs text-slate-500">
        Uruchom skaner, aby zobaczyć repozytoria znalezione w workspace.
      </p>
    );
  }
  if (scan.phase === "scanning") {
    return <p className="text-xs text-slate-400">Przeszukiwanie workspace…</p>;
  }
  if (scan.phase === "error") {
    return <p className="text-xs text-rose-300">{scan.message}</p>;
  }

  const { repos } = scan;
  if (repos.length === 0) {
    return <p className="text-xs text-slate-500">Nie znaleziono repozytoriów Git w workspace.</p>;
  }

  const newCount = repos.filter((repo) => !repo.alreadyRegistered).length;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Znaleziono {repos.length}{" "}
        {pluralizePl(repos.length, "repozytorium", "repozytoria", "repozytoriów")}, nowych:{" "}
        <span className="font-mono text-slate-200">{newCount}</span>
      </p>
      <ul className="space-y-2">
        {repos.map((repo) => (
          <li
            key={repo.relPath}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-surface-950/70 p-3"
          >
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-white">{repo.name}</div>
              <div className="truncate font-mono text-[11px] text-slate-500">/{repo.relPath}</div>
            </div>
            {repo.alreadyRegistered ? (
              <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                Zarejestrowany
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onRegister(repo)}
                disabled={registering.has(repo.relPath)}
                className="shrink-0 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-[10px] font-medium text-indigo-200 transition hover:bg-indigo-500/25 disabled:cursor-wait disabled:opacity-60"
              >
                {registering.has(repo.relPath) ? "Dodaję…" : "Dodaj do monitoringu"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
