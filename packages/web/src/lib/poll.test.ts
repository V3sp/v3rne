import { describe, expect, test } from "bun:test";
import { formatSyncLabel, isPollDue } from "./poll";

describe("isPollDue", () => {
  test("is due only once a full interval has passed", () => {
    expect(isPollDue(1_000, 60_999, 60_000)).toBe(false);
    expect(isPollDue(1_000, 61_000, 60_000)).toBe(true);
    expect(isPollDue(1_000, 500_000, 60_000)).toBe(true);
  });
});

describe("formatSyncLabel", () => {
  const iso = "2026-11-23T10:00:00.000Z";
  const clock = new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

  test("shows absolute time followed by relative time", () => {
    const now = new Date(new Date(iso).getTime() + 30_000);
    expect(formatSyncLabel(iso, now)).toBe(`${clock} · przed chwilą`);
  });

  test("shows a dash when there was no successful sync or the value is invalid", () => {
    expect(formatSyncLabel(null)).toBe("—");
    expect(formatSyncLabel("nie-data")).toBe("—");
  });
});
