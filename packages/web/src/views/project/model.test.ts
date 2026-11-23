import { describe, expect, test } from "bun:test";
import type { Attachment, Comment, Task, TaskEvent } from "@v3rne/shared";
import type { GitCommit, ProjectWithGit } from "../../api/types";
import type { PlanFileDetail } from "./api";
import {
  ATTACHMENT_ACCEPT,
  INITIAL_TASK_FILTERS,
  attachmentAcceptTypes,
  attachmentHref,
  attachmentLimitMessage,
  commitsForTask,
  countCommitsByTask,
  describeTaskEvent,
  emptyTaskMessage,
  filterTasks,
  formatBytes,
  groupTasksByKanbanColumn,
  hasActiveTaskFilters,
  hasOpenDoubts,
  isInlinePreviewable,
  isOpenDoubt,
  isTextField,
  listPlanSections,
  mapAttachmentLinks,
  matchesTaskQuery,
  newestTaskEventsFirst,
  parsePriority,
  parseStatus,
  pickActivePlanFile,
  planFileContentMessage,
  planSectionsEmptyMessage,
  sectionBody,
  splitSearchTerms,
  toggleFilterValue,
  sectionStats,
  snapshotCommits,
  visiblePlanFileTabs,
} from "./model";

function makeTask(overrides: Partial<Task> & Pick<Task, "code">): Task {
  return {
    id: Number(overrides.code.replace(/\D/g, "")),
    projectId: "workflow-core",
    title: `Zadanie ${overrides.code}`,
    description: "",
    planFile: "plan.md",
    planSection: null,
    status: "ready",
    priority: "medium",
    sortOrder: 0,
    claimedBy: null,
    gitBranch: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

const SECTION_A = "1. Silnik stanów";
const SECTION_B = "2. Polityka ponowień";

const tasks: Task[] = [
  makeTask({ code: "WFC-1", planSection: SECTION_A, status: "done", priority: "high" }),
  makeTask({ code: "WFC-2", planSection: SECTION_A, status: "needs_input", priority: "urgent" }),
  makeTask({ code: "WFC-3", planSection: SECTION_B, status: "ready", priority: "low" }),
  makeTask({ code: "WFC-4", planSection: null, status: "backlog", priority: "medium" }),
  makeTask({ code: "WFC-5", planSection: SECTION_A, status: "cancelled", priority: "medium" }),
  makeTask({ code: "WFC-6", planSection: SECTION_B, status: "in_progress", priority: "high" }),
];

describe("filterTasks", () => {
  test("keeps every task when no filter is set", () => {
    expect(filterTasks(tasks, INITIAL_TASK_FILTERS).map((task) => task.code)).toEqual([
      "WFC-1",
      "WFC-2",
      "WFC-3",
      "WFC-4",
      "WFC-5",
      "WFC-6",
    ]);
  });

  test("filters by plan section by exact title", () => {
    const filtered = filterTasks(tasks, { ...INITIAL_TASK_FILTERS, planSection: SECTION_A });
    expect(filtered.map((task) => task.code)).toEqual(["WFC-1", "WFC-2", "WFC-5"]);
  });

  test("returns nothing for a section that has no tasks", () => {
    expect(filterTasks(tasks, { ...INITIAL_TASK_FILTERS, planSection: "Nieistniejąca" })).toEqual([]);
  });

  test("combines section, status and priority filters", () => {
    const filtered = filterTasks(tasks, {
      ...INITIAL_TASK_FILTERS,
      statuses: ["in_progress"],
      priorities: ["high"],
      planSection: SECTION_B,
    });
    expect(filtered.map((task) => task.code)).toEqual(["WFC-6"]);
  });

  test("does not mutate the input list", () => {
    const copy = [...tasks];
    filterTasks(tasks, { ...INITIAL_TASK_FILTERS, planSection: SECTION_A });
    expect(tasks).toEqual(copy);
  });

  test("matches several statuses and priorities as OR within each group, AND between groups", () => {
    const filtered = filterTasks(tasks, {
      ...INITIAL_TASK_FILTERS,
      statuses: ["done", "in_progress"],
      priorities: ["high", "urgent"],
    });
    expect(filtered.map((task) => task.code)).toEqual(["WFC-1", "WFC-6"]);
  });

  test("keeps only tasks with open doubts or needs_input", () => {
    const withOpenDoubts = [
      ...tasks,
      { ...makeTask({ code: "WFC-7", status: "ready" }), openDoubts: 1 } as Task,
    ];
    const filtered = filterTasks(withOpenDoubts, { ...INITIAL_TASK_FILTERS, onlyWithDoubts: true });
    expect(filtered.map((task) => task.code)).toEqual(["WFC-2", "WFC-7"]);
  });

  test("keeps only claimed tasks", () => {
    const claimed = [
      makeTask({ code: "WFC-8", claimedBy: "agent-a" }),
      makeTask({ code: "WFC-9", claimedBy: null }),
    ];
    const filtered = filterTasks(claimed, { ...INITIAL_TASK_FILTERS, onlyClaimed: true });
    expect(filtered.map((task) => task.code)).toEqual(["WFC-8"]);
  });

  test("combines text, status and doubt filters", () => {
    const filtered = filterTasks(tasks, {
      ...INITIAL_TASK_FILTERS,
      query: "WFC-2",
      statuses: ["needs_input"],
      onlyWithDoubts: true,
    });
    expect(filtered.map((task) => task.code)).toEqual(["WFC-2"]);
  });

  test("returns nothing when text matches but another filter excludes it", () => {
    const filtered = filterTasks(tasks, {
      ...INITIAL_TASK_FILTERS,
      query: "WFC-3",
      statuses: ["done"],
    });
    expect(filtered).toEqual([]);
  });
});

describe("matchesTaskQuery", () => {
  const task = makeTask({
    code: "WFC-14",
    title: "Retry z backoffem",
    description: "Ponawiaj wywołania HTTP z jitterem",
  });

  test("accepts an empty or whitespace-only query", () => {
    expect(matchesTaskQuery(task, "")).toBe(true);
    expect(matchesTaskQuery(task, "   ")).toBe(true);
  });

  test("matches the task code, ignoring case and surrounding spaces", () => {
    expect(matchesTaskQuery(task, "  wfc-14 ")).toBe(true);
    expect(matchesTaskQuery(task, "WFC-15")).toBe(false);
  });

  test("matches the title and the description", () => {
    expect(matchesTaskQuery(task, "BACKOFF")).toBe(true);
    expect(matchesTaskQuery(task, "jitterem")).toBe(true);
  });

  test("requires every word to match (AND)", () => {
    expect(matchesTaskQuery(task, "retry http")).toBe(true);
    expect(matchesTaskQuery(task, "retry kafka")).toBe(false);
  });

  test("splits on any run of whitespace and drops empty terms", () => {
    expect(splitSearchTerms("  retry \t  HTTP ")).toEqual(["retry", "http"]);
    expect(splitSearchTerms("   ")).toEqual([]);
  });
});

describe("hasOpenDoubts", () => {
  test("is true for needs_input and for a positive openDoubts count", () => {
    expect(hasOpenDoubts(makeTask({ code: "WFC-1", status: "needs_input" }))).toBe(true);
    expect(hasOpenDoubts({ ...makeTask({ code: "WFC-2" }), openDoubts: 2 } as Task)).toBe(true);
    expect(hasOpenDoubts({ ...makeTask({ code: "WFC-3" }), openDoubts: 0 } as Task)).toBe(false);
  });
});

describe("toggleFilterValue", () => {
  test("adds a missing value and removes a present one without mutating the input", () => {
    const values = ["ready" as const];
    expect(toggleFilterValue(values, "done")).toEqual(["ready", "done"]);
    expect(toggleFilterValue(values, "ready")).toEqual([]);
    expect(values).toEqual(["ready"]);
  });
});

describe("hasActiveTaskFilters", () => {
  test("is false for the initial filters and for a whitespace-only query", () => {
    expect(hasActiveTaskFilters(INITIAL_TASK_FILTERS)).toBe(false);
    expect(hasActiveTaskFilters({ ...INITIAL_TASK_FILTERS, query: "  " })).toBe(false);
  });

  test("is true when any filter, including the plan section, is set", () => {
    expect(hasActiveTaskFilters({ ...INITIAL_TASK_FILTERS, query: "x" })).toBe(true);
    expect(hasActiveTaskFilters({ ...INITIAL_TASK_FILTERS, onlyClaimed: true })).toBe(true);
    expect(hasActiveTaskFilters({ ...INITIAL_TASK_FILTERS, planSection: SECTION_A })).toBe(true);
  });
});

describe("emptyTaskMessage", () => {
  test("explains an empty project", () => {
    expect(emptyTaskMessage(0, INITIAL_TASK_FILTERS)).toBe("Brak zadań w tym projekcie.");
  });

  test("uses the section message when only the section filter is active", () => {
    expect(emptyTaskMessage(3, { ...INITIAL_TASK_FILTERS, planSection: SECTION_A })).toBe(
      "Brak zadań w tej sekcji planu.",
    );
  });

  test("falls back to the generic message when other filters narrow the list", () => {
    expect(
      emptyTaskMessage(3, { ...INITIAL_TASK_FILTERS, statuses: ["done"], planSection: SECTION_A }),
    ).toBe("Brak zadań dla wybranych filtrów.");
  });

  test("uses the generic message for a text search with no hits", () => {
    expect(emptyTaskMessage(3, { ...INITIAL_TASK_FILTERS, query: "nic-takiego" })).toBe(
      "Brak zadań dla wybranych filtrów.",
    );
  });
});

describe("groupTasksByKanbanColumn", () => {
  test("places each active task in its column and drops Backlog and Cancelled", () => {
    const groups = groupTasksByKanbanColumn(tasks);
    expect(groups.ready.map((task) => task.code)).toEqual(["WFC-3"]);
    expect(groups.in_progress.map((task) => task.code)).toEqual(["WFC-6"]);
    expect(groups.needs_input.map((task) => task.code)).toEqual(["WFC-2"]);
    expect(groups.done.map((task) => task.code)).toEqual(["WFC-1"]);

    const grouped = Object.values(groups).flat().map((task) => task.code);
    expect(grouped).not.toContain("WFC-4");
    expect(grouped).not.toContain("WFC-5");
  });

  test("keeps the input order inside a column", () => {
    const input = [
      makeTask({ code: "WFC-9", status: "done" }),
      makeTask({ code: "WFC-7", status: "done" }),
    ];
    expect(groupTasksByKanbanColumn(input).done.map((task) => task.code)).toEqual(["WFC-9", "WFC-7"]);
  });
});

describe("listPlanSections and sectionStats", () => {
  test("lists headings of every plan file with their level", () => {
    const sections = listPlanSections({
      files: [
        {
          path: "plan.md",
          origin: "file",
          exists: true,
          driftStatus: "clean",
          hash: null,
          storedHash: null,
          headings: [
            { level: 2, title: SECTION_A, slug: "x", line: 3 },
            { level: 3, title: "2.1 Podpunkt", slug: "y", line: 9 },
          ],
        },
        {
          path: "docs/phase-2.md",
          origin: "dir",
          exists: true,
          driftStatus: "clean",
          hash: null,
          storedHash: null,
          headings: [{ level: 2, title: "4. Kolejkowanie", slug: "z", line: 1 }],
        },
      ],
    });
    expect(sections.map((section) => [section.file, section.title, section.level])).toEqual([
      ["plan.md", SECTION_A, 2],
      ["plan.md", "2.1 Podpunkt", 3],
      ["docs/phase-2.md", "4. Kolejkowanie", 2],
    ]);
    expect(new Set(sections.map((section) => section.key)).size).toBe(3);
  });

  test("counts progress without cancelled tasks and flags open decisions", () => {
    const stats = sectionStats(tasks, SECTION_A);
    expect(stats.progress).toEqual({ done: 1, total: 2, percent: 50 });
    expect(stats.needsDecision).toBe(true);
  });

  test("a section without tasks has no progress and no decision", () => {
    expect(sectionStats(tasks, "Brak")).toEqual({
      progress: { done: 0, total: 0, percent: 0 },
      needsDecision: false,
    });
  });
});

describe("plan file view", () => {
  function makeFile(overrides: Partial<PlanFileDetail> & Pick<PlanFileDetail, "path">): PlanFileDetail {
    return {
      origin: "file",
      exists: true,
      driftStatus: "clean",
      hash: null,
      storedHash: null,
      headings: [],
      ...overrides,
    };
  }

  test("file tabs appear only when several existing files can be chosen", () => {
    const plan = makeFile({ path: "plan.md" });
    const docs = makeFile({ path: "docs/phase.md" });
    const missing = makeFile({ path: "docs/old.md", exists: false });
    expect(visiblePlanFileTabs([plan, docs, missing]).map((file) => file.path)).toEqual([
      "plan.md",
      "docs/phase.md",
    ]);
    expect(visiblePlanFileTabs([plan, missing])).toEqual([]);
  });

  test("active file keeps the selection while it exists, otherwise falls back to the first existing one", () => {
    const missing = makeFile({ path: "a.md", exists: false });
    const plan = makeFile({ path: "plan.md" });
    const docs = makeFile({ path: "docs/phase.md" });
    expect(pickActivePlanFile([missing, plan, docs], "docs/phase.md")?.path).toBe("docs/phase.md");
    expect(pickActivePlanFile([missing, plan, docs], "a.md")?.path).toBe("plan.md");
    expect(pickActivePlanFile([missing, plan, docs], "gone.md")?.path).toBe("plan.md");
    expect(pickActivePlanFile([missing], null)?.path).toBe("a.md");
    expect(pickActivePlanFile([], null)).toBeNull();
  });

  test("a blank or missing section body counts as no content", () => {
    expect(sectionBody({})).toBeNull();
    expect(sectionBody({ content: "" })).toBeNull();
    expect(sectionBody({ content: " \n\t" })).toBeNull();
    expect(sectionBody({ content: "- [ ] krok\n" })).toBe("- [ ] krok\n");
  });

  test("listPlanSections carries each section body", () => {
    const sections = listPlanSections({
      files: [
        makeFile({
          path: "plan.md",
          headings: [
            { level: 2, title: "Cel", slug: "cel", line: 1, content: "Opis celu." },
            { level: 2, title: "Pusta", slug: "pusta", line: 5, content: "  " },
            { level: 2, title: "Bez pola", slug: "bez", line: 9 },
          ],
        }),
      ],
    });
    expect(sections.map((section) => section.body)).toEqual(["Opis celu.", null, null]);
  });

  test("an empty section list explains a parse failure differently from a plan without headings", () => {
    expect(planSectionsEmptyMessage({ files: [makeFile({ path: "plan.md" })] })).toBe("Brak sekcji w plan.md.");
    expect(
      planSectionsEmptyMessage({ files: [makeFile({ path: "plan.md", error: "invalid utf-8" })] }),
    ).toBe("Nie udało się odczytać sekcji planu.");
  });

  test("full-file content states: missing file, absent content, empty file, readable file", () => {
    expect(planFileContentMessage({ exists: false, content: null })).toBe("Plik nie istnieje w repozytorium.");
    expect(planFileContentMessage({ exists: true })).toBe("Serwer nie zwrócił treści pliku.");
    expect(planFileContentMessage({ exists: true, content: null })).toBe("Serwer nie zwrócił treści pliku.");
    expect(planFileContentMessage({ exists: true, content: "  \n" })).toBe("Plik jest pusty.");
    expect(planFileContentMessage({ exists: true, content: "# Plan" })).toBeNull();
  });
});

describe("attachments", () => {
  function makeAttachment(overrides: Partial<Attachment>): Attachment {
    return {
      id: 7,
      taskId: 1,
      commentId: null,
      filename: "screen.png",
      mimeType: "image/png",
      storagePath: "/data/uploads/x/screen.png",
      sizeBytes: 2048,
      createdAt: "2026-11-20T10:00:00.000Z",
      ...overrides,
    };
  }

  test("links point to the raw endpoint under the API base", () => {
    expect(attachmentHref(42)).toBe("/api/v1/attachments/42/raw");
  });

  test("raster images get an inline preview", () => {
    const [link] = mapAttachmentLinks([makeAttachment({ mimeType: "image/png" })]);
    expect(link).toMatchObject({
      id: 7,
      filename: "screen.png",
      href: "/api/v1/attachments/7/raw",
      previewUrl: "/api/v1/attachments/7/raw",
      sizeLabel: "2,0 KB",
    });
  });

  test("SVG is never previewed inline and stays a download link", () => {
    const [link] = mapAttachmentLinks([
      makeAttachment({ filename: "diagram.svg", mimeType: "image/svg+xml" }),
    ]);
    expect(link?.previewUrl).toBeNull();
    expect(link?.href).toBe("/api/v1/attachments/7/raw");
  });

  test("non-image files have no preview", () => {
    expect(isInlinePreviewable("application/pdf")).toBe(false);
    expect(isInlinePreviewable("image/jpeg; charset=binary")).toBe(true);
    expect(isInlinePreviewable("IMAGE/WEBP")).toBe(true);
  });

  test("formats sizes in bytes, KB and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5,0 MB");
  });

  test("the 413 limit is shown in Polish with a readable size", () => {
    expect(attachmentLimitMessage("Attachment exceeds the 10485760 byte limit")).toBe(
      "Plik przekracza limit 10,0 MB.",
    );
    expect(attachmentLimitMessage("Attachment exceeds the 524288 byte limit")).toBe(
      "Plik przekracza limit 512,0 KB.",
    );
  });

  test("an unparseable 413 message falls back to a generic sentence", () => {
    expect(attachmentLimitMessage("Attachment exceeds the limit")).toBe(
      "Plik przekracza limit rozmiaru załącznika.",
    );
    expect(attachmentLimitMessage("")).toBe("Plik przekracza limit rozmiaru załącznika.");
  });

  test("the picker accepts every inline image type plus documents", () => {
    const types = attachmentAcceptTypes();
    expect(new Set(types).size).toBe(types.length);
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(types).toContain(mime);
    }
    expect(types).toContain("image/svg+xml");
    expect(types).toContain("application/pdf");
    expect(ATTACHMENT_ACCEPT).toBe(types.join(","));
  });

  test("text fields keep their native paste behaviour", () => {
    expect(isTextField("INPUT")).toBe(true);
    expect(isTextField("textarea")).toBe(true);
    expect(isTextField("select")).toBe(true);
    expect(isTextField("div", true)).toBe(true);
    expect(isTextField("div")).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe("git commits", () => {
  function makeCommit(hash: string, taskCode: string | null): GitCommit {
    return {
      hash,
      shortHash: hash.slice(0, 7),
      date: "2026-11-20T10:00:00+00:00",
      author: "dev",
      subject: `[${taskCode ?? "-"}] zmiana`,
      taskCode,
    };
  }

  const commits = [
    makeCommit("a91f3c2aaaa", "WFC-12"),
    makeCommit("4b82e10bbbb", null),
    makeCommit("1c2d3e4cccc", "WFC-12"),
    makeCommit("9f8e7d6dddd", "WFC-3"),
  ];

  test("matches commits to a task by taskCode", () => {
    expect(commitsForTask(commits, "WFC-12").map((commit) => commit.shortHash)).toEqual([
      "a91f3c2",
      "1c2d3e4",
    ]);
    expect(commitsForTask(commits, "WFC-99")).toEqual([]);
  });

  test("counts commits per task and skips commits without a task code", () => {
    const counts = countCommitsByTask(commits);
    expect(counts.get("WFC-12")).toBe(2);
    expect(counts.get("WFC-3")).toBe(1);
    expect(counts.has("null")).toBe(false);
    expect(counts.size).toBe(2);
  });

  test("reads commits from the snapshot, falling back to lastCommit when the list is absent", () => {
    const base: ProjectWithGit = {
      id: "workflow-core",
      codePrefix: "WFC",
      name: "Workflow Core",
      relPath: "workflow-core",
      planFiles: [],
      planDirs: [],
      planDirsOverride: false,
      agentDocs: [],
      planHashes: {},
      nextTaskSeq: 1,
      active: true,
      createdAt: "2026-11-01T00:00:00.000Z",
      git: null,
    };
    expect(snapshotCommits(null)).toEqual([]);

    const withList = {
      ...base,
      git: {
        repoPath: "/x",
        branch: "main",
        dirtyFiles: 0,
        worktrees: [],
        ahead: 0,
        behind: 0,
        lastCommit: commits[0] ?? null,
        commits,
      },
    } as ProjectWithGit;
    expect(snapshotCommits(withList.git)).toHaveLength(4);

    const withoutList = {
      ...base,
      git: {
        repoPath: "/x",
        branch: "main",
        dirtyFiles: 0,
        worktrees: [],
        ahead: 0,
        behind: 0,
        lastCommit: commits[0] ?? null,
      },
    } as ProjectWithGit;
    expect(snapshotCommits(withoutList.git)).toEqual([commits[0]!]);
  });
});

describe("parsing and doubts", () => {
  test("parses only known status and priority values", () => {
    expect(parseStatus("needs_input")).toBe("needs_input");
    expect(parseStatus("bogus")).toBeNull();
    expect(parsePriority("urgent")).toBe("urgent");
    expect(parsePriority("")).toBeNull();
  });

  test("an open doubt is an unresolved comment of kind doubt", () => {
    const base: Comment = {
      id: 1,
      taskId: 1,
      authorType: "agent",
      authorName: "opencode",
      kind: "doubt",
      body: "Który wariant?",
      isResolved: false,
      resolvedAt: null,
      createdAt: "2026-11-20T10:00:00.000Z",
    };
    expect(isOpenDoubt(base)).toBe(true);
    expect(isOpenDoubt({ ...base, isResolved: true })).toBe(false);
    expect(isOpenDoubt({ ...base, kind: "comment" })).toBe(false);
  });
});

describe("task history", () => {
  type EventFields = Pick<TaskEvent, "eventType" | "oldValue" | "newValue">;

  const fields = (eventType: string, oldValue: string | null = null, newValue: string | null = null): EventFields => ({
    eventType,
    oldValue,
    newValue,
  });

  test("describes status and priority changes with Polish labels", () => {
    expect(describeTaskEvent(fields("status_changed", "ready", "in_progress"))).toBe(
      "status: Ready → In Progress",
    );
    expect(describeTaskEvent(fields("priority_changed", "low", "urgent"))).toBe("priorytet: Low → Urgent");
  });

  test("describes completion, doubts and entries", () => {
    expect(describeTaskEvent(fields("created"))).toBe("utworzono");
    expect(describeTaskEvent(fields("completed", "in_progress", "done"))).toBe("zamknięto");
    expect(describeTaskEvent(fields("doubt_opened", "ready", "needs_input"))).toBe("zgłoszono wątpliwość");
    expect(describeTaskEvent(fields("doubt_resolved", "doubt:3", "decision:4"))).toBe("rozwiązano wątpliwość");
    expect(describeTaskEvent(fields("entry_added", null, "progress"))).toBe("dodano wpis");
  });

  test("describes claims, agent reassignment and unclaiming", () => {
    expect(describeTaskEvent(fields("claimed", "ready", "in_progress"))).toBe("przejęto zadanie");
    expect(describeTaskEvent(fields("claimed_by_changed", "alpha", "beta"))).toBe("przypisanie: @alpha → @beta");
    expect(describeTaskEvent(fields("claimed_by_changed", null, "beta"))).toBe("przypisanie: — → @beta");
    expect(describeTaskEvent(fields("unclaimed", "alpha", null))).toBe("zwolniono zadanie");
  });

  test("describes branch changes, using a dash for a cleared branch", () => {
    expect(describeTaskEvent(fields("branch_changed", null, "feat/x"))).toBe("gałąź: — → feat/x");
    expect(describeTaskEvent(fields("branch_changed", "feat/x", null))).toBe("gałąź: feat/x → —");
  });

  test("keeps raw values for unknown statuses and priorities", () => {
    expect(describeTaskEvent(fields("status_changed", "ready", "archived"))).toBe("status: Ready → archived");
    expect(describeTaskEvent(fields("priority_changed", null, "critical"))).toBe("priorytet: — → critical");
  });

  test("falls back to the raw event type for unknown events", () => {
    expect(describeTaskEvent(fields("renamed", "a", "b"))).toBe("renamed");
  });

  test("orders events newest first without mutating the input", () => {
    const events = [1, 3, 2].map(
      (id): TaskEvent => ({
        id,
        projectId: "workflow-core",
        taskId: 1,
        eventType: "created",
        oldValue: null,
        newValue: null,
        actor: "human",
        createdAt: "2026-11-20T10:00:00.000Z",
      }),
    );
    expect(newestTaskEventsFirst(events).map((event) => event.id)).toEqual([3, 2, 1]);
    expect(events.map((event) => event.id)).toEqual([1, 3, 2]);
  });
});
