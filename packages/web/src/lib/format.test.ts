import { describe, expect, test } from "bun:test";
import {
  formatProgressLabel,
  formatRelativeTime,
  pluralizePl,
  summarizeProgress,
} from "./format";

const task = (status: "backlog" | "ready" | "in_progress" | "needs_input" | "done" | "cancelled") => ({
  status,
});

describe("summarizeProgress", () => {
  test("counts done over all tasks except cancelled", () => {
    const progress = summarizeProgress([
      task("done"),
      task("done"),
      task("ready"),
      task("backlog"),
      task("cancelled"),
    ]);
    expect(progress).toEqual({ done: 2, total: 4, percent: 50 });
    expect(formatProgressLabel(progress)).toBe("2/4");
  });

  test("rounds to whole percent", () => {
    expect(summarizeProgress([task("done"), task("ready"), task("ready")]).percent).toBe(33);
    expect(summarizeProgress([task("done"), task("done"), task("ready")]).percent).toBe(67);
  });

  test("empty or fully cancelled input yields zero, not NaN", () => {
    expect(summarizeProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
    expect(summarizeProgress([task("cancelled")])).toEqual({ done: 0, total: 0, percent: 0 });
  });
});

describe("pluralizePl", () => {
  test("uses Polish plural forms", () => {
    const forms = (n: number) => pluralizePl(n, "wątpliwość", "wątpliwości", "wątpliwości");
    expect(forms(1)).toBe("wątpliwość");
    expect(forms(2)).toBe("wątpliwości");
    expect(forms(4)).toBe("wątpliwości");
    expect(forms(5)).toBe("wątpliwości");
    expect(forms(12)).toBe("wątpliwości");
    expect(forms(22)).toBe("wątpliwości");
  });

  test("12-14 are treated as many, not few", () => {
    expect(pluralizePl(12, "plan", "plany", "planów")).toBe("planów");
    expect(pluralizePl(13, "plan", "plany", "planów")).toBe("planów");
    expect(pluralizePl(22, "plan", "plany", "planów")).toBe("plany");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date(2026, 10, 22, 12, 0, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  test("recent times use minutes", () => {
    expect(formatRelativeTime(ago(10_000), now)).toBe("przed chwilą");
    expect(formatRelativeTime(ago(18 * 60_000), now)).toBe("18 min temu");
  });

  test("same calendar day uses hours", () => {
    expect(formatRelativeTime(new Date(2026, 10, 22, 10, 0).toISOString(), now)).toBe(
      "2 godz. temu",
    );
  });

  test("previous calendar day is yesterday, then counted days", () => {
    expect(formatRelativeTime(new Date(2026, 10, 21, 23, 0).toISOString(), now)).toBe("wczoraj");
    expect(formatRelativeTime(new Date(2026, 10, 19, 9, 0).toISOString(), now)).toBe("3 dni temu");
  });

  test("invalid input yields a placeholder", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("—");
  });
});
