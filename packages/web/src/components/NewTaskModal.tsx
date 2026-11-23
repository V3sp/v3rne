import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Priority } from "@v3rne/shared";
import { ApiError, describeError } from "../api/client";
import { fetchProjects } from "../api/projects";
import { createTask } from "../api/tasks";
import type { ProjectWithGit } from "../api/types";
import { PRIORITY_META } from "../lib/status";
import { useToast } from "./Toasts";
import { PRIORITY_ORDER } from "../views/project/model";
import { fetchPlanDetail, type PlanDetail } from "../views/project/api";

export interface NewTaskModalProps {
  open: boolean;
  /** Preselected project (usually the one open in the workspace); falls back to the first active project. */
  defaultProjectId?: string | null;
  onClose: () => void;
  onCreated: () => void;
}

export interface PlanSectionOption {
  /** Unique across files: `${planFile}:${headingLine}`. */
  key: string;
  title: string;
  planFile: string;
  /** Human-readable label shown in the select, e.g. `plan.md → 1. Silnik stanów`. */
  label: string;
}

/** Minimal plan shape the section mapper needs; `PlanDetail` satisfies it structurally. */
export interface PlanSectionSource {
  files: Array<{
    path: string;
    headings: Array<{ title: string; line: number }>;
  }>;
}

/** Maps plan headings (all configured plan files, any level) to select options. */
export function planSectionOptions(plan: PlanSectionSource | null): PlanSectionOption[] {
  if (!plan) return [];
  return plan.files.flatMap((file) =>
    file.headings.map((heading) => ({
      key: `${file.path}:${heading.line}`,
      title: heading.title,
      planFile: file.path,
      label: `${file.path} → ${heading.title}`,
    })),
  );
}

export interface NewTaskDraft {
  projectId: string;
  title: string;
}

export interface NewTaskFormErrors {
  projectId?: string;
  title?: string;
}

const MAX_TITLE_LENGTH = 200;

/** Pure form validation; the server repeats the required-title check with its own 400 response. */
export function validateNewTaskDraft(draft: NewTaskDraft): NewTaskFormErrors {
  const errors: NewTaskFormErrors = {};
  if (!draft.projectId.trim()) errors.projectId = "Wybierz projekt.";
  const title = draft.title.trim();
  if (!title) {
    errors.title = "Podaj tytuł zadania.";
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.title = `Tytuł może mieć maksymalnie ${MAX_TITLE_LENGTH} znaków.`;
  }
  return errors;
}

/** Polish message for the inline error box; the raw server text is only used for network failures. */
export function createTaskErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return describeError(err);
  if (err.status === 0) return err.message;
  if (err.status === 409 && err.code === "duplicate_title") {
    return "Zadanie o tym tytule już istnieje w tej sekcji planu (duplicate_title).";
  }
  if (err.status === 409) {
    return `Nie udało się dodać zadania — konflikt danych (${err.code}).`;
  }
  if (err.status === 400) {
    return `Serwer odrzucił dane zadania (${err.code}). Sprawdź tytuł i wybraną sekcję planu.`;
  }
  if (err.status === 404) {
    return "Wybrany projekt nie istnieje lub został usunięty.";
  }
  return `Nie udało się dodać zadania (HTTP ${err.status}, ${err.code}).`;
}

export function NewTaskModal({ open, defaultProjectId = null, onClose, onCreated }: NewTaskModalProps) {
  const showToast = useToast();
  const titleRef = useRef<HTMLInputElement>(null);

  const [projects, setProjects] = useState<ProjectWithGit[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsAttempt, setProjectsAttempt] = useState(0);

  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<Priority>("high");
  const [sectionKey, setSectionKey] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<NewTaskFormErrors>({});

  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planAttempt, setPlanAttempt] = useState(0);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the form and load only active projects each time the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setTitle("");
    setDescription("");
    setErrors({});
    setSubmitError(null);
    setBusy(false);
    setPriority("high");
    setSectionKey("");
    setPlan(null);
    setPlanLoading(false);
    setPlanError(null);
    setProjects(null);
    setProjectsError(null);

    fetchProjects().then(
      (list) => {
        if (cancelled) return;
        const active = list.filter((project) => project.active);
        setProjects(active);
        const preferred = active.find((project) => project.id === defaultProjectId) ?? active[0] ?? null;
        setProjectId(preferred?.id ?? "");
      },
      (err: unknown) => {
        if (cancelled) return;
        setProjectsError(describeError(err));
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open, defaultProjectId, projectsAttempt]);

  // Sections depend on the selected project and are refetched whenever it changes.
  useEffect(() => {
    if (!open || !projectId) {
      setPlan(null);
      setPlanLoading(false);
      setPlanError(null);
      setSectionKey("");
      return;
    }
    let cancelled = false;

    setPlan(null);
    setPlanLoading(true);
    setPlanError(null);
    setSectionKey("");

    fetchPlanDetail(projectId).then(
      (detail) => {
        if (!cancelled) setPlan(detail);
      },
      (err: unknown) => {
        if (!cancelled) setPlanError(describeError(err));
      },
    ).finally(() => {
      if (!cancelled) setPlanLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, projectId, planAttempt]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => titleRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Escape closes the modal; the background scroll is locked while it is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const sections = planSectionOptions(plan);
  const activeProjects = projects ?? [];
  const noActiveProjects = projects !== null && activeProjects.length === 0;
  const formDisabled = busy || noActiveProjects;
  const submitDisabled = formDisabled || projects === null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitDisabled) return;

    const nextErrors = validateNewTaskDraft({ projectId, title });
    setErrors(nextErrors);
    if (nextErrors.projectId !== undefined || nextErrors.title !== undefined) return;

    const section = sections.find((option) => option.key === sectionKey) ?? null;
    setBusy(true);
    setSubmitError(null);
    try {
      const task = await createTask(projectId, {
        title: title.trim(),
        description: description.trim(),
        priority,
        status: "ready",
        planFile: section?.planFile ?? null,
        planSection: section?.title ?? null,
      });
      showToast(`Utworzono zadanie ${task.code} (status: Ready)`, "success");
      onCreated();
      onClose();
    } catch (err) {
      setSubmitError(createTaskErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[1px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-task-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg animate-fade rounded-xl border border-slate-700/80 bg-surface-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h3 id="new-task-modal-title" className="text-sm font-semibold text-white">
            Dodaj nowe zadanie
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno dodawania zadania"
            className="px-1 text-lg leading-none text-slate-400 hover:text-white"
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-task-project" className="mb-1 block text-xs text-slate-400">
                Projekt
              </label>
              <select
                id="new-task-project"
                value={projectId}
                disabled={formDisabled || projects === null}
                onChange={(event) => setProjectId(event.target.value)}
                className="w-full rounded-md border border-slate-700 bg-surface-850 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-60"
              >
                {projects === null && <option value="">Ładowanie projektów…</option>}
                {noActiveProjects && <option value="">Brak aktywnych projektów</option>}
                {activeProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} ({project.codePrefix})
                  </option>
                ))}
              </select>
              {errors.projectId && (
                <p role="alert" className="mt-1 text-[11px] text-rose-300">
                  {errors.projectId}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="new-task-priority" className="mb-1 block text-xs text-slate-400">
                Priorytet
              </label>
              <select
                id="new-task-priority"
                value={priority}
                disabled={formDisabled || projects === null}
                onChange={(event) => setPriority(event.target.value as Priority)}
                className="w-full rounded-md border border-slate-700 bg-surface-850 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-60"
              >
                {PRIORITY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_META[value].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {projectsError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px] text-rose-300"
            >
              <span>{projectsError}</span>
              <button
                type="button"
                onClick={() => setProjectsAttempt((attempt) => attempt + 1)}
                className="shrink-0 text-indigo-300 hover:underline"
              >
                Spróbuj ponownie
              </button>
            </div>
          )}

          {noActiveProjects && (
            <p className="rounded-lg border border-slate-800 bg-surface-950/70 p-2.5 text-[11px] text-slate-400">
              Włącz co najmniej jeden projekt w Konfiguratorze, aby dodać zadanie.
            </p>
          )}

          <div>
            <label htmlFor="new-task-section" className="mb-1 block text-xs text-slate-400">
              Sekcja w plan.md (opcjonalnie)
            </label>
            <select
              id="new-task-section"
              value={sectionKey}
              disabled={formDisabled || planLoading || sections.length === 0}
              onChange={(event) => setSectionKey(event.target.value)}
              className="w-full rounded-md border border-slate-700 bg-surface-850 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-60"
            >
              <option value="">— brak powiązania z sekcją —</option>
              {sections.map((section) => (
                <option key={section.key} value={section.key}>
                  {section.label}
                </option>
              ))}
            </select>
            {planLoading && <p className="mt-1 text-[11px] text-slate-500">Ładowanie sekcji planu…</p>}
            {!planLoading && planError && (
              <p className="mt-1 text-[11px] text-amber-300">
                Nie udało się pobrać sekcji planu: {planError}{" "}
                <button
                  type="button"
                  onClick={() => setPlanAttempt((attempt) => attempt + 1)}
                  className="text-indigo-300 hover:underline"
                >
                  Ponów
                </button>
              </p>
            )}
            {!planLoading && !planError && projectId !== "" && sections.length === 0 && (
              <p className="mt-1 text-[11px] text-slate-500">Ten projekt nie ma nagłówków w plikach planu.</p>
            )}
          </div>

          <div>
            <label htmlFor="new-task-title" className="mb-1 block text-xs text-slate-400">
              Tytuł zadania
            </label>
            <input
              id="new-task-title"
              ref={titleRef}
              required
              maxLength={MAX_TITLE_LENGTH}
              value={title}
              disabled={formDisabled}
              aria-invalid={errors.title !== undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                if (errors.title !== undefined) setErrors((current) => ({ ...current, title: undefined }));
              }}
              placeholder="np. Obsługa retry z exponential backoff"
              className="w-full rounded-md border border-slate-700 bg-surface-850 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
            />
            {errors.title && (
              <p role="alert" className="mt-1 text-[11px] text-rose-300">
                {errors.title}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="new-task-description" className="mb-1 block text-xs text-slate-400">
              Opis / Kryteria akceptacji
            </label>
            <textarea
              id="new-task-description"
              rows={3}
              value={description}
              disabled={formDisabled}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={"- Kryterium 1\n- Kryterium 2"}
              className="w-full rounded-md border border-slate-700 bg-surface-850 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
            />
          </div>

          {submitError && (
            <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px] text-rose-300">
              {submitError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700 disabled:opacity-60"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Dodawanie…" : "Dodaj do Ready"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
