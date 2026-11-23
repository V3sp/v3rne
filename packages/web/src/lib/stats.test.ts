import { describe, expect, test } from "bun:test";
import {
  aggregateStatusTotals,
  describeEvent,
  emptyStatusCounts,
  formatDoubtAverage,
  formatWeekLabel,
  isVelocityEmpty,
  sumStatusCounts,
} from "./stats";

describe("formatDoubtAverage", () => {
  test("shows minutes below one hour", () => {
    expect(formatDoubtAverage(26)).toBe("26 min");
    expect(formatDoubtAverage(26.4)).toBe("26 min");
    expect(formatDoubtAverage(0)).toBe("0 min");
  });

  test("shows hours and remaining minutes", () => {
    expect(formatDoubtAverage(125)).toBe("2 h 5 min");
    expect(formatDoubtAverage(60)).toBe("1 h");
    expect(formatDoubtAverage(120)).toBe("2 h");
  });

  test("rounding can carry minutes into a full hour", () => {
    expect(formatDoubtAverage(59.6)).toBe("1 h");
  });

  test("missing average is a placeholder, not a number", () => {
    expect(formatDoubtAverage(null)).toBe("brak danych");
    expect(formatDoubtAverage(Number.NaN)).toBe("brak danych");
  });
});

describe("sumStatusCounts and aggregateStatusTotals", () => {
  test("sums one project's statuses, ignoring missing keys", () => {
    expect(sumStatusCounts({ ready: 2, done: 3 })).toBe(5);
    expect(sumStatusCounts({})).toBe(0);
  });

  test("aggregates per-project distributions into global totals", () => {
    const totals = aggregateStatusTotals([
      { statuses: { ...emptyStatusCounts(), ready: 2, done: 1 } },
      { statuses: { ...emptyStatusCounts(), ready: 1, needs_input: 4 } },
    ]);
    expect(totals.ready).toBe(3);
    expect(totals.done).toBe(1);
    expect(totals.needs_input).toBe(4);
    expect(totals.backlog).toBe(0);
    expect(sumStatusCounts(totals)).toBe(8);
  });

  test("aggregating no projects yields all zeros", () => {
    expect(aggregateStatusTotals([])).toEqual(emptyStatusCounts());
  });
});

describe("isVelocityEmpty", () => {
  test("detects a series made only of zeros", () => {
    expect(isVelocityEmpty([{ count: 0 }, { count: 0 }])).toBe(true);
    expect(isVelocityEmpty([])).toBe(true);
  });

  test("any completed task makes the series non-empty", () => {
    expect(isVelocityEmpty([{ count: 0 }, { count: 1 }])).toBe(false);
  });
});

describe("formatWeekLabel", () => {
  test("turns ISO week keys into short Polish labels", () => {
    expect(formatWeekLabel("2026-W47")).toBe("Tydz. 47");
    expect(formatWeekLabel("2026-W04")).toBe("Tydz. 4");
  });

  test("keeps unknown formats unchanged", () => {
    expect(formatWeekLabel("foo")).toBe("foo");
  });
});

describe("describeEvent", () => {
  test("describes status and priority transitions with readable labels", () => {
    expect(
      describeEvent({ eventType: "status_changed", oldValue: "needs_input", newValue: "ready" }),
    ).toBe("Status: Needs Input → Ready");
    expect(
      describeEvent({ eventType: "priority_changed", oldValue: "low", newValue: "urgent" }),
    ).toBe("Priorytet: Low → Urgent");
  });

  test("describes other events in Polish and passes unknown types through", () => {
    const base = { oldValue: null, newValue: null };
    expect(describeEvent({ ...base, eventType: "doubt_opened" })).toBe("Zgłoszono wątpliwość");
    expect(describeEvent({ ...base, eventType: "completed" })).toBe("Ukończono zadanie");
    expect(describeEvent({ ...base, eventType: "mystery" })).toBe("mystery");
  });
});
