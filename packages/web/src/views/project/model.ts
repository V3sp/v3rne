import type { Attachment, Comment, Priority, Status, Task, TaskEvent } from "@v3rne/shared";
import { API_BASE } from "../../api/client";
import type { GitCommit, ProjectWithGit } from "../../api/types";
import { summarizeProgress, type ProgressSummary } from "../../lib/format";
import { KANBAN_STATUSES, PRIORITY_META, STATUS_META, STATUS_ORDER } from "../../lib/status";
import type { PlanDetail } from "./api";

export type KanbanStatus = Extract<Status, "ready" | "in_progress" | "needs_input" | "done">;

export function isKanbanColumn(status: Status): status is KanbanStatus {
  return KANBAN_STATUSES.includes(status);
}

export const KANBAN_COLUMNS: readonly KanbanStatus[] = KANBAN_STATUSES.filter(isKanbanColumn);

export const PRIORITY_ORDER: readonly Priority[] = ["urgent", "high", "medium", "low"];

export interface TaskFilters {
  /** Free text; every whitespace-separated term must occur in the code, title or description. */
  query: string;
  /** Empty array means "any status". */
  statuses: Status[];
  /** Empty array means "any priority". */
  priorities: Priority[];
  onlyWithDoubts: boolean;
  onlyClaimed: boolean;
  planSection: string | null;
}

export const INITIAL_TASK_FILTERS: TaskFilters = {
  query: "",
  statuses: [],
  priorities: [],
  onlyWithDoubts: false,
  onlyClaimed: false,
  planSection: null,
};

export function splitSearchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter((term) => term.length > 0);
}

export function matchesTaskQuery(task: Pick<Task, "code" | "title" | "description">, query: string): boolean {
  const terms = splitSearchTerms(query);
  if (terms.length === 0) return true;
  const haystack = `${task.code}\n${task.title}\n${task.description}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** The REST list does not send `openDoubts`; `needs_input` is the fallback that always marks an open doubt. */
export function hasOpenDoubts(task: Task): boolean {
  const { openDoubts } = task as Task & { openDoubts?: number };
  return task.status === "needs_input" || (openDoubts ?? 0) > 0;
}

export function toggleFilterValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function hasActiveTaskFilters(filters: TaskFilters): boolean {
  return (
    splitSearchTerms(filters.query).length > 0 ||
    filters.statuses.length > 0 ||
    filters.priorities.length > 0 ||
    filters.onlyWithDoubts ||
    filters.onlyClaimed ||
    filters.planSection !== null
  );
}

/** Filters the full task list; `planSection` matches the heading title exactly, like the server's `planSection` query. */
export function filterTasks(tasks: readonly Task[], filters: TaskFilters): Task[] {
  return tasks.filter(
    (task) =>
      matchesTaskQuery(task, filters.query) &&
      (filters.statuses.length === 0 || filters.statuses.includes(task.status)) &&
      (filters.priorities.length === 0 || filters.priorities.includes(task.priority)) &&
      (!filters.onlyWithDoubts || hasOpenDoubts(task)) &&
      (!filters.onlyClaimed || task.claimedBy !== null) &&
      (filters.planSection === null || task.planSection === filters.planSection),
  );
}

export function emptyTaskMessage(totalTasks: number, filters: TaskFilters): string {
  if (totalTasks === 0) return "Brak zadań w tym projekcie.";
  const onlySection =
    filters.planSection !== null && !hasActiveTaskFilters({ ...filters, planSection: null });
  if (onlySection) return "Brak zadań w tej sekcji planu.";
  return "Brak zadań dla wybranych filtrów.";
}

export function parseStatus(value: string): Status | null {
  return STATUS_ORDER.find((status) => status === value) ?? null;
}

export function parsePriority(value: string): Priority | null {
  return PRIORITY_ORDER.find((priority) => priority === value) ?? null;
}

/** Each task lands in exactly one column; Backlog and Cancelled are not part of the board. */
export function groupTasksByKanbanColumn(tasks: readonly Task[]): Record<KanbanStatus, Task[]> {
  const groups: Record<KanbanStatus, Task[]> = {
    ready: [],
    in_progress: [],
    needs_input: [],
    done: [],
  };
  for (const task of tasks) {
    if (isKanbanColumn(task.status)) groups[task.status].push(task);
  }
  return groups;
}

export interface PlanSectionEntry {
  key: string;
  file: string;
  title: string;
  level: 1 | 2 | 3;
}

export function listPlanSections(plan: Pick<PlanDetail, "files">): PlanSectionEntry[] {
  return plan.files.flatMap((file) =>
    file.headings.map((heading) => ({
      key: `${file.path}:${heading.line}`,
      file: file.path,
      title: heading.title,
      level: heading.level,
    })),
  );
}

export interface SectionStats {
  progress: ProgressSummary;
  needsDecision: boolean;
}

export function sectionStats(tasks: readonly Task[], sectionTitle: string): SectionStats {
  const sectionTasks = tasks.filter((task) => task.planSection === sectionTitle);
  return {
    progress: summarizeProgress(sectionTasks),
    needsDecision: sectionTasks.some((task) => task.status === "needs_input"),
  };
}

type GitSnapshotWithCommits = NonNullable<ProjectWithGit["git"]> & { commits?: GitCommit[] };

/** The shared mirror of the Git snapshot omits `commits`, which the server sends with every snapshot. */
export function snapshotCommits(git: ProjectWithGit["git"]): GitCommit[] {
  if (!git) return [];
  const { commits } = git as GitSnapshotWithCommits;
  if (Array.isArray(commits)) return commits;
  return git.lastCommit ? [git.lastCommit] : [];
}

export function commitsForTask(commits: readonly GitCommit[], taskCode: string): GitCommit[] {
  return commits.filter((commit) => commit.taskCode === taskCode);
}

export function countCommitsByTask(commits: readonly GitCommit[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const commit of commits) {
    if (commit.taskCode) counts.set(commit.taskCode, (counts.get(commit.taskCode) ?? 0) + 1);
  }
  return counts;
}

export function isOpenDoubt(comment: Comment): boolean {
  return comment.kind === "doubt" && !comment.isResolved;
}

const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** SVG is deliberately excluded: an inline SVG can carry scripts, so it is only offered as a download. */
export function isInlinePreviewable(mimeType: string): boolean {
  const base = (mimeType.split(";")[0] ?? "").trim().toLowerCase();
  return INLINE_IMAGE_TYPES.has(base);
}

/** Formats offered in the file picker; everything else can still be dropped or pasted. */
const ACCEPT_EXTRA_TYPES: readonly string[] = [
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
];

/** The picker hint reuses the inline-preview list, so both stay in sync. */
export function attachmentAcceptTypes(): string[] {
  return [...INLINE_IMAGE_TYPES, ...ACCEPT_EXTRA_TYPES];
}

export const ATTACHMENT_ACCEPT = attachmentAcceptTypes().join(",");

/** True when a paste should keep its native meaning instead of becoming an attachment upload. */
export function isTextField(tagName: string | null | undefined, contentEditable = false): boolean {
  if (contentEditable) return true;
  const tag = (tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/**
 * The server's 413 message embeds the byte limit in English; show it in Polish with a
 * readable size, falling back to a generic sentence when the limit cannot be parsed.
 */
export function attachmentLimitMessage(serverMessage: string): string {
  const match = /(\d+)\s*byte/i.exec(serverMessage);
  const limit = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(limit) && limit > 0
    ? `Plik przekracza limit ${formatBytes(limit)}.`
    : "Plik przekracza limit rozmiaru załącznika.";
}

export function attachmentHref(attachmentId: number): string {
  return `${API_BASE}/attachments/${attachmentId}/raw`;
}

export interface AttachmentLink {
  id: number;
  filename: string;
  href: string;
  sizeLabel: string;
  /** Set only for raster images that may be rendered inline. */
  previewUrl: string | null;
}

export function mapAttachmentLinks(attachments: readonly Attachment[]): AttachmentLink[] {
  return attachments.map((attachment) => {
    const href = attachmentHref(attachment.id);
    return {
      id: attachment.id,
      filename: attachment.filename,
      href,
      sizeLabel: formatBytes(attachment.sizeBytes),
      previewUrl: isInlinePreviewable(attachment.mimeType) ? href : null,
    };
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${toPolishDecimal(bytes / 1024)} KB`;
  return `${toPolishDecimal(bytes / 1024 ** 2)} MB`;
}

function toPolishDecimal(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

export const TASK_EVENTS_PREVIEW_LIMIT = 20;

/** Ids grow with insertion, so descending id is the newest-first order without relying on timestamp ties. */
export function newestTaskEventsFirst(events: readonly TaskEvent[]): TaskEvent[] {
  return [...events].sort((a, b) => b.id - a.id);
}

const EVENT_EMPTY_VALUE = "—";

function statusLabel(value: string | null): string {
  if (value === null) return EVENT_EMPTY_VALUE;
  const status = parseStatus(value);
  return status ? STATUS_META[status].label : value;
}

function priorityLabel(value: string | null): string {
  if (value === null) return EVENT_EMPTY_VALUE;
  const priority = parsePriority(value);
  return priority ? PRIORITY_META[priority].label : value;
}

function agentLabel(value: string | null): string {
  return value === null ? EVENT_EMPTY_VALUE : `@${value}`;
}

function transition(from: string | null, to: string | null, format: (value: string | null) => string): string {
  return `${format(from)} → ${format(to)}`;
}

/** Polish one-line summary of a task event; unknown event types fall back to their raw name. */
export function describeTaskEvent(event: Pick<TaskEvent, "eventType" | "oldValue" | "newValue">): string {
  switch (event.eventType) {
    case "created":
      return "utworzono";
    case "status_changed":
      return `status: ${transition(event.oldValue, event.newValue, statusLabel)}`;
    case "completed":
      return "zamknięto";
    case "priority_changed":
      return `priorytet: ${transition(event.oldValue, event.newValue, priorityLabel)}`;
    case "doubt_opened":
      return "zgłoszono wątpliwość";
    case "doubt_resolved":
      return "rozwiązano wątpliwość";
    case "claimed":
      return "przejęto zadanie";
    case "claimed_by_changed":
      return `przypisanie: ${transition(event.oldValue, event.newValue, agentLabel)}`;
    case "unclaimed":
      return "zwolniono zadanie";
    case "branch_changed":
      return `gałąź: ${transition(event.oldValue, event.newValue, (value) => value ?? EVENT_EMPTY_VALUE)}`;
    case "entry_added":
      return "dodano wpis";
    default:
      return event.eventType;
  }
}

