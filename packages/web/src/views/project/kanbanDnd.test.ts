import { describe, expect, test } from "bun:test";
import type { Task } from "@v3rne/shared";
import {
  insertionIndexAfterRemoval,
  isStatusChange,
  kanbanColumns,
  planKanbanMove,
  sortKanbanTasks,
  tasksSignature,
  type KanbanTaskPatch,
} from "./kanbanDnd";

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

function codes(tasks: readonly Task[]): string[] {
  return tasks.map((task) => task.code);
}

function patchFor(patches: readonly KanbanTaskPatch[], code: string): KanbanTaskPatch | undefined {
  return patches.find((patch) => patch.code === code);
}

function byCode(tasks: readonly Task[]): Record<string, Task> {
  return Object.fromEntries(tasks.map((task) => [task.code, task]));
}

describe("sortKanbanTasks", () => {
  test("orders by sortOrder, then priority, then id", () => {
    const sorted = sortKanbanTasks([
      makeTask({ code: "WFC-3", sortOrder: 1, priority: "urgent" }),
      makeTask({ code: "WFC-1", sortOrder: 1, priority: "low" }),
      makeTask({ code: "WFC-2", sortOrder: 0, priority: "low" }),
      makeTask({ code: "WFC-4", sortOrder: 1, priority: "urgent" }),
    ]);
    expect(codes(sorted)).toEqual(["WFC-2", "WFC-3", "WFC-4", "WFC-1"]);
  });

  test("does not mutate the input", () => {
    const tasks = [
      makeTask({ code: "WFC-1", sortOrder: 2 }),
      makeTask({ code: "WFC-2", sortOrder: 1 }),
    ];
    sortKanbanTasks(tasks);
    expect(codes(tasks)).toEqual(["WFC-1", "WFC-2"]);
  });
});

describe("kanbanColumns", () => {
  test("keeps only the four board statuses and sorts each column", () => {
    const columns = kanbanColumns([
      makeTask({ code: "WFC-1", status: "ready", sortOrder: 0 }),
      makeTask({ code: "WFC-2", status: "done", sortOrder: 1 }),
      makeTask({ code: "WFC-3", status: "backlog" }),
      makeTask({ code: "WFC-4", status: "done", sortOrder: 0 }),
      makeTask({ code: "WFC-5", status: "cancelled" }),
      makeTask({ code: "WFC-6", status: "in_progress" }),
      makeTask({ code: "WFC-7", status: "needs_input" }),
    ]);

    expect(codes(columns.ready)).toEqual(["WFC-1"]);
    expect(codes(columns.done)).toEqual(["WFC-4", "WFC-2"]);
    expect(codes(columns.in_progress)).toEqual(["WFC-6"]);
    expect(codes(columns.needs_input)).toEqual(["WFC-7"]);
    expect(Object.values(columns).flat().map((task) => task.status)).toEqual([
      "ready",
      "in_progress",
      "needs_input",
      "done",
      "done",
    ]);
  });
});

describe("isStatusChange", () => {
  test("detects a column change", () => {
    expect(isStatusChange(makeTask({ code: "WFC-1", status: "ready" }), "done")).toBe(true);
    expect(isStatusChange(makeTask({ code: "WFC-1", status: "done" }), "done")).toBe(false);
  });
});

describe("tasksSignature", () => {
  const tasks = [
    makeTask({ code: "WFC-1", status: "ready", sortOrder: 0 }),
    makeTask({ code: "WFC-2", status: "ready", sortOrder: 1 }),
    makeTask({ code: "WFC-3", status: "done", sortOrder: 0 }),
  ];

  test("ignores array identity and keeps the same fingerprint for equal content", () => {
    expect(tasksSignature([...tasks.map((task) => ({ ...task }))])).toBe(tasksSignature(tasks));
  });

  test("changes when a card switches column", () => {
    const next = planKanbanMove(tasks, "WFC-1", { status: "done", index: 1 }).nextTasks;
    expect(tasksSignature(next)).not.toBe(tasksSignature(tasks));
  });

  test("changes when a card only changes its position", () => {
    const next = planKanbanMove(tasks, "WFC-2", { status: "ready", index: 0 }).nextTasks;
    expect(tasksSignature(next)).not.toBe(tasksSignature(tasks));
  });
});

describe("insertionIndexAfterRemoval", () => {
  const column = ["WFC-1", "WFC-2", "WFC-3"];

  test("keeps the raw slot when the card comes from another column", () => {
    expect(insertionIndexAfterRemoval(column, "WFC-9", 1)).toBe(1);
    expect(insertionIndexAfterRemoval(column, "WFC-9", 3)).toBe(3);
  });

  test("compensates for the card that leaves the same column", () => {
    expect(insertionIndexAfterRemoval(column, "WFC-1", 3)).toBe(2);
    expect(insertionIndexAfterRemoval(column, "WFC-2", 3)).toBe(2);
  });

  test("keeps slots before the dragged card untouched", () => {
    expect(insertionIndexAfterRemoval(column, "WFC-3", 0)).toBe(0);
    expect(insertionIndexAfterRemoval(column, "WFC-3", 2)).toBe(2);
  });

  test("clamps out-of-range slots", () => {
    expect(insertionIndexAfterRemoval(column, "WFC-9", -4)).toBe(0);
    expect(insertionIndexAfterRemoval(column, "WFC-9", 99)).toBe(3);
  });
});

describe("planKanbanMove — reorder inside a column", () => {
  const tasks = [
    makeTask({ code: "WFC-1", sortOrder: 0 }),
    makeTask({ code: "WFC-2", sortOrder: 1 }),
    makeTask({ code: "WFC-3", sortOrder: 2 }),
    makeTask({ code: "WFC-4", status: "done", sortOrder: 0 }),
  ];

  test("renumbers the column and sends only the changed sortOrder values", () => {
    const plan = planKanbanMove(tasks, "WFC-1", { status: "ready", index: 2 });

    expect(plan.statusChanged).toBe(false);
    expect(codes(kanbanColumns(plan.nextTasks).ready)).toEqual(["WFC-2", "WFC-3", "WFC-1"]);
    expect(plan.patches).toEqual([
      { code: "WFC-2", sortOrder: 0 },
      { code: "WFC-3", sortOrder: 1 },
      { code: "WFC-1", sortOrder: 2 },
    ]);
    for (const patch of plan.patches) expect(patch.status).toBeUndefined();
  });

  test("dropping a card back in place sends nothing", () => {
    const plan = planKanbanMove(tasks, "WFC-2", { status: "ready", index: 1 });

    expect(plan.patches).toEqual([]);
    expect(plan.nextTasks).toEqual(tasks);
  });

  test("clamps an index past the column end", () => {
    const plan = planKanbanMove(tasks, "WFC-1", { status: "ready", index: 99 });

    expect(codes(kanbanColumns(plan.nextTasks).ready)).toEqual(["WFC-2", "WFC-3", "WFC-1"]);
  });
});

describe("planKanbanMove — drop into another column", () => {
  const tasks = [
    makeTask({ code: "WFC-1", status: "ready", sortOrder: 0 }),
    makeTask({ code: "WFC-2", status: "done", sortOrder: 0 }),
    makeTask({ code: "WFC-3", status: "done", sortOrder: 1 }),
    makeTask({ code: "WFC-4", status: "done", sortOrder: 2 }),
  ];

  test("sets done on the dragged card and keeps its drop position", () => {
    const plan = planKanbanMove(tasks, "WFC-1", { status: "done", index: 1 });

    expect(plan.statusChanged).toBe(true);
    expect(plan.patches).toEqual([
      { code: "WFC-1", status: "done", sortOrder: 1 },
      { code: "WFC-3", sortOrder: 2 },
      { code: "WFC-4", sortOrder: 3 },
    ]);
    const next = byCode(plan.nextTasks);
    expect(next["WFC-1"]?.status).toBe("done");
    expect(next["WFC-1"]?.sortOrder).toBe(1);
    expect(next["WFC-2"]?.sortOrder).toBe(0);
    expect(next["WFC-4"]?.sortOrder).toBe(3);
  });

  test("sends status only when the target column is empty", () => {
    const plan = planKanbanMove(tasks, "WFC-1", { status: "needs_input", index: 0 });

    expect(plan.patches).toEqual([{ code: "WFC-1", status: "needs_input" }]);
    expect(plan.nextTasks.find((task) => task.code === "WFC-1")?.status).toBe("needs_input");
  });

  test("moving out of Done changes the status like any other column", () => {
    const plan = planKanbanMove(tasks, "WFC-2", { status: "ready", index: 0 });

    expect(patchFor(plan.patches, "WFC-2")).toEqual({ code: "WFC-2", status: "ready" });
    expect(byCode(plan.nextTasks)["WFC-2"]?.status).toBe("ready");
  });

  test("ignores codes that are not on the board", () => {
    expect(planKanbanMove(tasks, "WFC-99", { status: "done", index: 0 }).patches).toEqual([]);

    const withBacklog = [...tasks, makeTask({ code: "WFC-5", status: "backlog" })];
    const plan = planKanbanMove(withBacklog, "WFC-5", { status: "ready", index: 0 });
    expect(plan.patches).toEqual([]);
  });
});
