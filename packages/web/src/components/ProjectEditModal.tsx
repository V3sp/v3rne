import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { Project } from "@v3rne/shared";
import { ApiError, describeError } from "../api/client";
import { updateProject } from "../api/config";
import type { ProjectWithGit } from "../api/types";
import {
  CONFIG_DEFAULT_PLAN_DIRS_HINT,
  buildProjectPatch,
  normalizePathList,
  projectFormValues,
  validateProjectForm,
  validateRelativePath,
  type ProjectFormErrors,
  type ProjectFormValues,
} from "../lib/config";
import { useToast } from "./Toasts";

interface ProjectEditModalProps {
  project: ProjectWithGit;
  onClose: () => void;
  /** Receives the saved project; the caller reloads its lists and shows the toast. */
  onSaved: (project: Project) => void;
}

const INPUT_CLASS =
  "w-full rounded-md border border-slate-700 bg-surface-850 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-60";

export function ProjectEditModal({ project, onClose, onSaved }: ProjectEditModalProps) {
  const showToast = useToast();
  const [values, setValues] = useState<ProjectFormValues>(() => projectFormValues(project));
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Escape closes the modal; the background scroll is locked while it is open.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [busy, onClose]);

  const update = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const nextErrors = validateProjectForm(values);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some((message) => message !== undefined)) return;

    const patch = buildProjectPatch(project, values);
    if (Object.keys(patch).length === 0) {
      showToast("Brak zmian do zapisania", "info");
      onClose();
      return;
    }

    setBusy(true);
    setSubmitError(null);
    try {
      const saved = await updateProject(project.id, patch);
      onSaved(saved);
    } catch (err) {
      setSubmitError(describeError(err));
      if (err instanceof ApiError && err.code === "code_prefix_locked") {
        setErrors((current) => ({ ...current, codePrefix: err.message }));
      }
    } finally {
      setBusy(false);
    }
  };

  const defaultPlanDirs = project.planDirsOverride ? CONFIG_DEFAULT_PLAN_DIRS_HINT : project.planDirs;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[1px]"
      onClick={() => !busy && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-project-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg animate-fade flex-col rounded-xl border border-slate-700/80 bg-surface-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h3 id="edit-project-title" className="text-sm font-semibold text-white">
            Edycja projektu <span className="font-mono text-slate-400">{project.codePrefix}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Zamknij edycję projektu"
            className="px-1 text-lg leading-none text-slate-400 hover:text-white disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <Field id="edit-project-name" label="Nazwa" error={errors.name}>
              <input
                id="edit-project-name"
                value={values.name}
                disabled={busy}
                onChange={(event) => update("name", event.target.value)}
                className={INPUT_CLASS}
              />
            </Field>

            <Field
              id="edit-project-code-prefix"
              label="Prefiks kodu"
              error={errors.codePrefix}
              hint="Nieedytowalny po utworzeniu zadań. Gdy projekt ma zadania, serwer odrzuci zmianę (409 code_prefix_locked)."
            >
              <input
                id="edit-project-code-prefix"
                value={values.codePrefix}
                disabled={busy}
                onChange={(event) => update("codePrefix", event.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
            </Field>

            <Field
              id="edit-project-rel-path"
              label="Ścieżka względna"
              error={errors.relPath}
              hint="Zmiana wymaga, żeby katalog istniał w workspace."
            >
              <input
                id="edit-project-rel-path"
                value={values.relPath}
                disabled={busy}
                onChange={(event) => update("relPath", event.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
            </Field>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">Katalogi planów</span>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={values.useDefaultPlanDirs}
                    disabled={busy}
                    onChange={(event) => update("useDefaultPlanDirs", event.target.checked)}
                    className="h-4 w-4 accent-indigo-500 disabled:cursor-wait"
                  />
                  Domyślne z configu
                </label>
              </div>
              {values.useDefaultPlanDirs ? (
                <p className="font-mono text-[11px] text-slate-500">
                  Podpowiedź (domyślne z config.yaml): {defaultPlanDirs.join(", ") || "—"}
                </p>
              ) : (
                <TagField
                  id="edit-project-plan-dirs"
                  label="Katalogi planów"
                  placeholder="np. context"
                  values={values.planDirs}
                  error={errors.planDirs}
                  disabled={busy}
                  onChange={(next) => update("planDirs", next)}
                />
              )}
            </div>

            <TagField
              id="edit-project-plan-files"
              label="Pliki planu"
              placeholder="np. docs/plan.md"
              values={values.planFiles}
              error={errors.planFiles}
              disabled={busy}
              onChange={(next) => update("planFiles", next)}
            />

            <TagField
              id="edit-project-agent-docs"
              label="Dokumenty agenta"
              placeholder="np. AGENTS.md"
              values={values.agentDocs}
              error={errors.agentDocs}
              disabled={busy}
              onChange={(next) => update("agentDocs", next)}
            />

            {submitError && (
              <p role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {submitError}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:text-white disabled:opacity-50"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Zapisywanie…" : "Zapisz"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-slate-400">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}

interface TagFieldProps {
  id: string;
  label: string;
  placeholder: string;
  values: readonly string[];
  error?: string;
  disabled: boolean;
  onChange: (values: string[]) => void;
}

/** Path list as removable chips; duplicates and blanks are dropped on every change. */
function TagField({ id, label, placeholder, values, error, disabled, onChange }: TagFieldProps) {
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  const add = () => {
    const candidate = draft.trim();
    if (candidate.length === 0) return;
    const problem = validateRelativePath(candidate);
    if (problem) {
      setDraftError(problem);
      return;
    }
    onChange(normalizePathList([...values, candidate]));
    setDraft("");
    setDraftError(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  };

  const message = draftError ?? error ?? null;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-slate-400">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftError(null);
          }}
          onKeyDown={onKeyDown}
          className={`${INPUT_CLASS} font-mono`}
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || draft.trim().length === 0}
          className="shrink-0 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Dodaj
        </button>
      </div>
      {values.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li
              key={value}
              className="flex items-center gap-1 rounded border border-slate-700 bg-surface-950 px-2 py-0.5 font-mono text-[11px] text-slate-300"
            >
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((item) => item !== value))}
                disabled={disabled}
                aria-label={`Usuń ${value}`}
                className="px-0.5 text-slate-500 hover:text-rose-300 disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p role="alert" className="mt-1 text-[11px] text-rose-300">
          {message}
        </p>
      )}
    </div>
  );
}
