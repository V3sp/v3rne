import { useState } from "react";
import type { Task } from "@v3rne/shared";
import { MarkdownView } from "../../components/MarkdownView";
import { useToast } from "../../components/Toasts";
import { buildBreakdownPrompt } from "../../lib/breakdownPrompt";
import { formatProgressLabel } from "../../lib/format";
import type { PlanDetail, PlanFileDetail, ProjectDocsResponse } from "./api";
import {
  listPlanSections,
  pickActivePlanFile,
  planFileContentMessage,
  planSectionsEmptyMessage,
  sectionStats,
  visiblePlanFileTabs,
} from "./model";
import { EmptyBox, InlineError, SegmentButton } from "./primitives";

interface PlanTabProps {
  projectId: string;
  projectName: string;
  plan: PlanDetail | null;
  planError: string | null;
  tasks: Task[];
  selectedSection: string | null;
  onSelectSection: (title: string | null) => void;
  onAcknowledgeDrift: () => void;
}

type PlanView = "sections" | "file";

export function PlanTab({
  projectId,
  projectName,
  plan,
  planError,
  tasks,
  selectedSection,
  onSelectSection,
  onAcknowledgeDrift,
}: PlanTabProps) {
  const showToast = useToast();
  const [view, setView] = useState<PlanView>("sections");
  const [fileTab, setFileTab] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (planError) return <InlineError message={planError} />;
  if (!plan) return null;
  if (plan.files.length === 0) return <EmptyBox>Brak skonfigurowanych plików planu.</EmptyBox>;

  const driftFiles = plan.files.filter((file) => file.driftStatus === "drift").map((file) => file.path);
  const sections = listPlanSections(plan);
  const fileTabs = visiblePlanFileTabs(plan.files);
  const activeFile = pickActivePlanFile(plan.files, fileTab);

  return (
    <div className="space-y-3">
      {plan.drift && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3">
          <div className="text-xs text-indigo-200">
            <div className="font-medium">
              Wykryto dryf pliku <span className="font-mono">{driftFiles.join(", ")}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-indigo-300/80">
              Hash SHA-256 zmienił się od ostatniego rozbicia.
            </div>
          </div>
          <button
            type="button"
            onClick={onAcknowledgeDrift}
            className="shrink-0 rounded bg-indigo-600 px-2.5 py-1 text-[11px] text-white transition hover:bg-indigo-500"
          >
            Zatwierdź stan
          </button>
        </div>
      )}

      {plan.files.map((file) => {
        const notice = fileNotice(file);
        return notice ? (
          <div key={file.path} className="text-[11px] text-slate-400">
            <span className="font-mono text-slate-300">{file.path}</span> — {notice}
          </div>
        ) : null;
      })}

      <div className="flex gap-1 rounded-lg bg-surface-950/60 p-0.5 w-fit">
        <SegmentButton active={view === "sections"} onClick={() => setView("sections")}>
          Sekcje
        </SegmentButton>
        <SegmentButton active={view === "file"} onClick={() => setView("file")}>
          Cały plik
        </SegmentButton>
      </div>

      {view === "sections" ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              Kliknij sekcję, aby przefiltrować zadania i zobaczyć jej treść
            </span>
            {selectedSection !== null && (
              <button
                type="button"
                onClick={() => {
                  onSelectSection(null);
                  setExpandedKey(null);
                }}
                className="text-[11px] text-indigo-400 hover:underline"
              >
                Pokaż wszystkie
              </button>
            )}
          </div>

          {sections.length === 0 ? (
            <EmptyBox>{planSectionsEmptyMessage(plan)}</EmptyBox>
          ) : (
            sections.map((section) => {
              const stats = sectionStats(tasks, section.title);
              const selected = selectedSection === section.title;
              const expanded = expandedKey === section.key;
              const copyPrompt = () => {
                const prompt = buildBreakdownPrompt({
                  projectId,
                  projectName,
                  planPath: section.file,
                  sectionTitle: section.title,
                  level: section.level,
                });
                void copyText(prompt).then(
                  () => showToast("Skopiowano prompt do rozbicia sekcji", "success"),
                  () => showToast("Nie udało się skopiować promptu.", "warn"),
                );
              };
              return (
                <div key={section.key} style={{ paddingLeft: (section.level - 1) * 12 }} className="space-y-1.5">
                  <div className="flex items-stretch gap-2">
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-expanded={expanded}
                      onClick={() => {
                        onSelectSection(selected ? null : section.title);
                        setExpandedKey(expanded ? null : section.key);
                      }}
                      className={`block min-w-0 flex-1 rounded-lg border p-3 text-left transition ${
                        selected
                          ? "border-indigo-500/50 bg-indigo-500/10"
                          : "border-slate-800 bg-surface-950/60 hover:border-slate-700"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-slate-100">{section.title}</span>
                          <span className="mt-0.5 block font-mono text-[10px] text-slate-500">{section.file}</span>
                        </span>
                        <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                          {formatProgressLabel(stats.progress)}
                        </span>
                      </span>
                      {stats.needsDecision && (
                        <span className="mt-2 block text-[10px] text-amber-300">● wymaga decyzji</span>
                      )}
                    </button>
                    <button
                      type="button"
                      title="Kopiuj prompt do rozbicia sekcji"
                      onClick={(event) => {
                        event.stopPropagation();
                        copyPrompt();
                      }}
                      className="shrink-0 self-start rounded-lg border border-slate-800 bg-surface-950/60 px-2.5 py-3 text-[11px] text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
                    >
                      Kopiuj prompt
                    </button>
                  </div>
                  {expanded && (
                    <div className="rounded-lg border border-slate-800 bg-surface-950/70 p-3">
                      {section.body === null ? (
                        <p className="text-[11px] text-slate-500">Ta sekcja nie ma treści.</p>
                      ) : (
                        <MarkdownView source={section.body} />
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </>
      ) : (
        <div className="space-y-2">
          {fileTabs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {fileTabs.map((file) => (
                <SegmentButton
                  key={file.path}
                  active={activeFile?.path === file.path}
                  onClick={() => setFileTab(file.path)}
                >
                  <span className="font-mono">{file.path}</span>
                </SegmentButton>
              ))}
            </div>
          )}
          {activeFile && <PlanFileBody file={activeFile} />}
        </div>
      )}
    </div>
  );
}

function PlanFileBody({ file }: { file: PlanFileDetail }) {
  if (file.error) return <InlineError message={file.error} />;
  const message = planFileContentMessage(file);
  if (message !== null) return <EmptyBox>{message}</EmptyBox>;
  return (
    <div className="max-h-[560px] overflow-auto rounded-lg border border-slate-800 bg-surface-950/70 p-4">
      <MarkdownView source={file.content} />
    </div>
  );
}

/** Clipboard API first, then a hidden textarea for browsers or contexts where it is unavailable. */
async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the textarea fallback.
  }
  if (!copyWithTextarea(text)) throw new Error("clipboard unavailable");
}

function copyWithTextarea(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

function fileNotice(file: PlanFileDetail): string | null {
  if (file.error) return file.error;
  if (!file.exists) return "plik nie istnieje w repozytorium";
  return null;
}

export function DocsTab({ docs, docsError }: { docs: ProjectDocsResponse | null; docsError: string | null }) {
  if (docsError) return <InlineError message={docsError} />;
  if (!docs || docs.files.length === 0) {
    return <EmptyBox>Brak skonfigurowanych dokumentów agenta.</EmptyBox>;
  }

  return (
    <div className="space-y-3">
      {docs.files.map((file) => (
        <div key={file.path} className="overflow-hidden rounded-lg border border-slate-800 bg-surface-950/70">
          <div className="flex items-center justify-between border-b border-slate-800 bg-surface-850 px-3 py-2">
            <span className="font-mono text-xs text-indigo-300">{file.path}</span>
            <span className="font-mono text-[10px] text-slate-500">read-only</span>
          </div>
          {file.error ? (
            <p className="p-3 text-[11px] text-rose-300">{file.error}</p>
          ) : file.content === null || !file.exists ? (
            <p className="p-3 text-[11px] text-slate-500">Plik nie istnieje.</p>
          ) : (
            <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-slate-300">
              {file.content}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
