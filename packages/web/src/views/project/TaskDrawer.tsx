import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Comment, Priority, Status } from "@v3rne/shared";
import { deleteAttachment, uploadTaskAttachment } from "../../api/attachments";
import { ApiError, describeError } from "../../api/client";
import type { GitCommit } from "../../api/types";
import { ErrorState, Loader } from "../../components/StatusViews";
import { useToast } from "../../components/Toasts";
import { useTaskDetail } from "../../hooks/useTaskDetail";
import { formatRelativeTime, pluralizePl } from "../../lib/format";
import { PRIORITY_META, STATUS_META, STATUS_ORDER } from "../../lib/status";
import {
  addTaskComment,
  resolveDoubt,
  updateTask,
  type TaskDetail,
} from "./api";
import {
  ATTACHMENT_ACCEPT,
  PRIORITY_ORDER,
  TASK_EVENTS_PREVIEW_LIMIT,
  attachmentLimitMessage,
  commitsForTask,
  describeTaskEvent,
  isOpenDoubt,
  isTextField,
  mapAttachmentLinks,
  newestTaskEventsFirst,
  parsePriority,
  parseStatus,
  type AttachmentLink,
} from "./model";

interface TaskDrawerProps {
  code: string;
  projectName: string;
  commits: GitCommit[];
  onClose: () => void;
  onChanged: () => void;
}

export function TaskDrawer({ code, projectName, commits, onClose, onChanged }: TaskDrawerProps) {
  const { state, reload } = useTaskDetail(code);
  const showToast = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /** Runs a mutation, then reloads the task and the project's task list. */
  const run = async (action: () => Promise<unknown>, successMessage: string): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      await reload();
      onChanged();
      showToast(successMessage, "success");
      return true;
    } catch (err) {
      showToast(describeError(err), "warn");
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Attachments upload outside `run` because they need their own progress and error state. */
  const reloadTask = useCallback(async () => {
    await reload();
    onChanged();
  }, [reload, onChanged]);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[1px]" aria-hidden="true" />
      <aside
        role="dialog"
        aria-label={`Zadanie ${code}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl animate-fade flex-col border-l border-slate-800 bg-surface-900 shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 font-mono text-xs font-semibold text-indigo-300">
              {code}
            </span>
            <span className="truncate text-xs text-slate-400">{projectName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij panel"
            className="px-1 text-lg leading-none text-slate-400 hover:text-white"
          >
            ×
          </button>
        </header>

        {state.status === "loading" && <Loader label="Ładowanie zadania…" />}
        {state.status === "error" && (
          <div className="p-5">
            <ErrorState message={state.message} onRetry={() => void reload()} />
          </div>
        )}
        {state.status === "ready" && (
          <TaskBody
            task={state.task}
            commits={commitsForTask(commits, code)}
            busy={busy}
            run={run}
            onReload={reloadTask}
          />
        )}
      </aside>
    </>
  );
}

interface TaskBodyProps {
  task: TaskDetail;
  commits: GitCommit[];
  busy: boolean;
  run: (action: () => Promise<unknown>, successMessage: string) => Promise<boolean>;
  onReload: () => Promise<void>;
}

function TaskBody({ task, commits, busy, run, onReload }: TaskBodyProps) {
  const showToast = useToast();
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const dragDepth = useRef(0);
  /** State updates are async, so a drop and a paste in the same tick must not upload twice. */
  const uploadInFlight = useRef(false);
  const attachments = mapAttachmentLinks(task.attachments);

  const uploadFiles = useCallback(
    async (files: readonly File[]) => {
      if (files.length === 0 || uploadInFlight.current) return;
      uploadInFlight.current = true;
      setUploadError(null);
      setUploading(true);
      let saved = 0;
      let failure: string | null = null;
      for (const file of files) {
        try {
          await uploadTaskAttachment(task.code, file);
          saved += 1;
        } catch (err) {
          failure = describeUploadError(err);
          break;
        }
      }
      uploadInFlight.current = false;
      setUploading(false);
      if (saved > 0) {
        await onReload();
        showToast(
          `Dodano ${saved} ${pluralizePl(saved, "załącznik", "załączniki", "załączników")}`,
          "success",
        );
      }
      if (failure) setUploadError(failure);
    },
    [onReload, showToast, task.code],
  );

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTextFieldTarget(event.target)) return;
      const files = clipboardFiles(event);
      if (files.length === 0) return;
      event.preventDefault();
      void uploadFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [uploadFiles]);

  const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void uploadFiles(files);
  };

  const dragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDropActive(true);
  };

  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const dragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropActive(false);
  };

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  };

  const removeAttachment = (link: AttachmentLink) => {
    if (!window.confirm(`Usunąć załącznik „${link.filename}”?`)) return;
    void run(() => deleteAttachment(link.id), "Usunięto załącznik");
  };

  const changeStatus = (value: string) => {
    const status = parseStatus(value);
    if (!status) return;
    void run(() => updateTask(task.code, { status }), "Zapisano status zadania");
  };

  const changePriority = (value: string) => {
    const priority = parsePriority(value);
    if (!priority) return;
    void run(() => updateTask(task.code, { priority }), "Zapisano priorytet zadania");
  };

  const resolve = (comment: Comment) => {
    const reply = (replies[comment.id] ?? "").trim();
    if (!reply) return;
    void run(() => resolveDoubt(comment.id, reply), "Wątpliwość rozwiązana").then((ok) => {
      if (ok) setReplies((current) => ({ ...current, [comment.id]: "" }));
    });
  };

  const submitComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = commentDraft.trim();
    if (!body) return;
    void run(() => addTaskComment(task.code, body), "Dodano komentarz").then((ok) => {
      if (ok) setCommentDraft("");
    });
  };

  return (
    <>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div>
          <h2 className="text-base font-semibold leading-snug text-white">{task.title}</h2>
          {task.planSection && (
            <div className="mt-1.5 font-mono text-xs text-indigo-300/90">
              ↳ {task.planFile ? `${task.planFile} § ` : ""}
              {task.planSection}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2.5 rounded-xl border border-slate-800 bg-surface-950/70 p-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-slate-500">Status</span>
            <select
              value={task.status}
              disabled={busy}
              onChange={(event) => changeStatus(event.target.value)}
              className="w-full rounded border border-slate-700 bg-surface-850 px-2 py-1 text-xs text-slate-200 disabled:opacity-60"
            >
              {STATUS_ORDER.map((status: Status) => (
                <option key={status} value={status}>
                  {STATUS_META[status].label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-slate-500">Priorytet</span>
            <select
              value={task.priority}
              disabled={busy}
              onChange={(event) => changePriority(event.target.value)}
              className="w-full rounded border border-slate-700 bg-surface-850 px-2 py-1 text-xs text-slate-200 disabled:opacity-60"
            >
              {PRIORITY_ORDER.map((priority: Priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_META[priority].label}
                </option>
              ))}
            </select>
          </label>
          <div className="min-w-0">
            <span className="mb-1 block text-[10px] uppercase text-slate-500">Agent / Branch</span>
            <span className="block truncate py-1 font-mono text-xs text-slate-300">
              {task.claimedBy ? `@${task.claimedBy}` : "—"}
            </span>
            {task.gitBranch && (
              <span className="block truncate font-mono text-[10px] text-slate-500">{task.gitBranch}</span>
            )}
          </div>
        </div>

        <DrawerSection title="Opis">
          <div className="whitespace-pre-wrap rounded-lg border border-slate-800/80 bg-surface-950/50 p-3 text-xs leading-relaxed text-slate-300">
            {task.description || "Brak opisu."}
          </div>
        </DrawerSection>

        <DrawerSection title={`Załączniki (${attachments.length})`}>
          <div
            onDragEnter={dragEnter}
            onDragOver={dragOver}
            onDragLeave={dragLeave}
            onDrop={dropFiles}
            aria-busy={uploading}
            className={`rounded-xl border p-3 transition ${
              dropActive ? "border-indigo-500 bg-indigo-500/10" : "border-slate-800 bg-surface-950/40"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                className={`cursor-pointer rounded-md border border-slate-700 bg-surface-850 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition hover:border-indigo-500 hover:text-white focus-within:border-indigo-500 ${
                  uploading || busy ? "pointer-events-none opacity-60" : ""
                }`}
              >
                Dodaj plik
                <input
                  type="file"
                  multiple
                  aria-label="Wybierz pliki do dodania"
                  accept={ATTACHMENT_ACCEPT}
                  disabled={uploading || busy}
                  onChange={pickFiles}
                  className="sr-only"
                />
              </label>
              <span className="text-[11px] text-slate-500">
                {uploading ? "Wysyłam…" : "albo przeciągnij plik / wklej Ctrl+V"}
              </span>
            </div>

            {uploadError && (
              <div
                role="alert"
                className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300"
              >
                {uploadError}
              </div>
            )}

            {attachments.length === 0 ? (
              <div className="mt-2 rounded-lg border border-dashed border-slate-800 p-3 text-center text-[11px] text-slate-500">
                Brak załączników. Przeciągnij plik tutaj lub wklej go ze schowka (Ctrl+V).
              </div>
            ) : (
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                {attachments.map((link) => (
                  <div
                    key={link.id}
                    className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-surface-950 p-2"
                  >
                    {link.previewUrl ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        title="Otwórz podgląd w nowej karcie"
                        className="block"
                      >
                        <img
                          src={link.previewUrl}
                          alt={link.filename}
                          loading="lazy"
                          className="h-28 w-full rounded bg-surface-900 object-contain"
                        />
                      </a>
                    ) : (
                      <a
                        href={link.href}
                        download={link.filename}
                        className="flex h-28 flex-col items-center justify-center gap-1 rounded bg-surface-900 text-[11px] text-slate-500 transition hover:text-slate-300"
                      >
                        <span>Brak podglądu</span>
                        <span className="text-indigo-300">Pobierz</span>
                      </a>
                    )}
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate font-mono text-slate-300" title={link.filename}>
                        {link.filename}
                      </span>
                      <span className="shrink-0 text-slate-500">{link.sizeLabel}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <a
                        href={link.href}
                        download={link.filename}
                        className="text-indigo-300 hover:underline"
                      >
                        Pobierz
                      </a>
                      <button
                        type="button"
                        disabled={busy || uploading}
                        onClick={() => removeAttachment(link)}
                        className="text-rose-400/80 transition hover:text-rose-300 disabled:opacity-50"
                      >
                        Usuń
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DrawerSection>

        {commits.length > 0 && (
          <DrawerSection title={`Powiązane commity (auto-detekcja [${task.code}])`}>
            <div className="space-y-1.5">
              {commits.map((commit) => (
                <div
                  key={commit.hash}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-surface-950 px-3 py-2 font-mono text-xs"
                >
                  <span className="truncate">
                    <span className="text-emerald-400">{commit.shortHash}</span>{" "}
                    <span className="text-slate-300">{commit.subject}</span>
                  </span>
                  <span className="ml-2 shrink-0 text-[10px] text-slate-500">
                    {formatRelativeTime(commit.date)}
                  </span>
                </div>
              ))}
            </div>
          </DrawerSection>
        )}

        <DrawerSection title={`Wątek komentarzy i wątpliwości (${task.comments.length})`}>
          <div className="space-y-2.5">
            {task.comments.length === 0 && <div className="text-xs text-slate-500">Brak wpisów.</div>}
            {task.comments.map((comment) => {
              const open = isOpenDoubt(comment);
              const boxClass = open
                ? "border-amber-500/40 bg-amber-500/10"
                : comment.kind === "doubt"
                  ? "border-emerald-500/25 bg-emerald-500/5"
                  : comment.authorType === "human"
                    ? "border-indigo-500/25 bg-indigo-500/10"
                    : "border-slate-800 bg-surface-950/70";
              return (
                <div key={comment.id} className={`space-y-2 rounded-lg border p-3 ${boxClass}`}>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={`font-semibold ${comment.authorType === "human" ? "text-indigo-300" : "text-slate-200"}`}
                      >
                        {comment.authorName}
                      </span>
                      <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                        {comment.kind}
                        {comment.kind === "doubt" ? (comment.isResolved ? " • rozwiązane" : " • otwarte") : ""}
                      </span>
                    </div>
                    <span className="shrink-0 text-slate-500" title={comment.createdAt}>
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-200">{comment.body}</div>
                  {open && (
                    <form
                      className="flex gap-2 pt-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        resolve(comment);
                      }}
                    >
                      <input
                        aria-label="Odpowiedź na wątpliwość"
                        value={replies[comment.id] ?? ""}
                        onChange={(event) =>
                          setReplies((current) => ({ ...current, [comment.id]: event.target.value }))
                        }
                        placeholder="Odpowiedz na wątpliwość..."
                        className="flex-1 rounded border border-slate-700 bg-surface-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={busy || (replies[comment.id] ?? "").trim().length === 0}
                        className="shrink-0 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Odpowiedz i odblokuj
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </DrawerSection>

        <DrawerSection title={`Historia (${task.events.length})`}>
          <HistoryList
            events={task.events}
            showAll={showAllEvents}
            onShowAll={() => setShowAllEvents(true)}
          />
        </DrawerSection>
      </div>

      <form onSubmit={submitComment} className="flex shrink-0 gap-2 border-t border-slate-800 bg-surface-950/80 p-4">
        <input
          aria-label="Nowy komentarz"
          required
          value={commentDraft}
          onChange={(event) => setCommentDraft(event.target.value)}
          placeholder="Dopisz uwagę lub wskazówkę dla agenta..."
          className="flex-1 rounded-lg border border-slate-700 bg-surface-900 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          Wyślij
        </button>
      </form>
    </>
  );
}

interface HistoryListProps {
  events: TaskDetail["events"];
  showAll: boolean;
  onShowAll: () => void;
}

function HistoryList({ events, showAll, onShowAll }: HistoryListProps) {
  if (events.length === 0) return <div className="text-xs text-slate-500">Brak zdarzeń.</div>;
  const ordered = newestTaskEventsFirst(events);
  const visible = showAll ? ordered : ordered.slice(0, TASK_EVENTS_PREVIEW_LIMIT);
  return (
    <div className="space-y-2">
      <ol className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-surface-950/50">
        {visible.map((event) => (
          <li key={event.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-xs">
            <span className="min-w-0 text-slate-300">
              <span className="font-semibold text-slate-200">{event.actor}</span> {describeTaskEvent(event)}
            </span>
            <span className="shrink-0 text-[10px] text-slate-500" title={event.createdAt}>
              {formatRelativeTime(event.createdAt)}
            </span>
          </li>
        ))}
      </ol>
      {!showAll && ordered.length > visible.length && (
        <button
          type="button"
          onClick={onShowAll}
          className="text-[11px] text-indigo-300 transition hover:text-indigo-200 hover:underline"
        >
          Pokaż wszystkie ({ordered.length})
        </button>
      )}
    </div>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function hasDraggedFiles(event: DragEvent<HTMLDivElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/** Screenshots land in `files`; some browsers expose them only as clipboard items. */
function clipboardFiles(event: ClipboardEvent): File[] {
  const data = event.clipboardData;
  if (!data) return [];
  const direct = Array.from(data.files ?? []);
  if (direct.length > 0) return direct;
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

/** Ctrl+V in a text field must keep its native paste behaviour. */
function isTextFieldTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isTextField(target.tagName, target.isContentEditable);
}

function describeUploadError(err: unknown): string {
  if (err instanceof ApiError && err.status === 413) return attachmentLimitMessage(err.message);
  return describeError(err);
}
