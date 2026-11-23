import { describe, expect, test } from "bun:test";
import type { Priority } from "@v3rne/shared";
import {
  KANBAN_STATUSES,
  PRIORITY_META,
  PRIORITY_RANK,
  STATUS_META,
  STATUS_ORDER,
  comparePriority,
  isKanbanStatus,
} from "./status";

describe("status mapping", () => {
  test("every status has an English sticker label", () => {
    expect(STATUS_ORDER.map((status) => STATUS_META[status].label)).toEqual([
      "Backlog",
      "Ready",
      "In Progress",
      "Needs Input",
      "Done",
      "Cancelled",
    ]);
  });

  test("Kanban shows exactly the four active columns", () => {
    expect(KANBAN_STATUSES).toEqual(["ready", "in_progress", "needs_input", "done"]);
  });

  test("Backlog and Cancelled are excluded from Kanban", () => {
    expect(isKanbanStatus("backlog")).toBe(false);
    expect(isKanbanStatus("cancelled")).toBe(false);
    expect(isKanbanStatus("needs_input")).toBe(true);
  });
});

describe("priority mapping", () => {
  test("labels are English and urgent sorts first", () => {
    expect(Object.values(PRIORITY_META).map((meta) => meta.label)).toEqual([
      "Urgent",
      "High",
      "Medium",
      "Low",
    ]);
    const shuffled: Priority[] = ["low", "urgent", "medium", "high"];
    expect([...shuffled].sort(comparePriority)).toEqual(["urgent", "high", "medium", "low"]);
  });

  test("rank is strictly increasing from urgent to low", () => {
    expect(PRIORITY_RANK.urgent).toBeLessThan(PRIORITY_RANK.high);
    expect(PRIORITY_RANK.high).toBeLessThan(PRIORITY_RANK.medium);
    expect(PRIORITY_RANK.medium).toBeLessThan(PRIORITY_RANK.low);
  });
});
