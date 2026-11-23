import { describe, expect, test } from "bun:test";
import {
  isTouchedFilesTruncated,
  resolveBranchState,
  shouldShowStaleBadge,
  shouldShowSyncBadge,
  staleBadgeLabel,
  touchedFilesTruncationLabel,
} from "./git-status";

describe("resolveBranchState", () => {
  test("named branch", () => {
    expect(resolveBranchState({ branch: "main", error: undefined })).toEqual({
      kind: "branch",
      name: "main",
    });
  });

  test("null branch on a readable repository is detached HEAD", () => {
    expect(resolveBranchState({ branch: null })).toEqual({ kind: "detached" });
  });

  test("missing snapshot or unreadable repository is unknown, not detached", () => {
    expect(resolveBranchState(null)).toEqual({ kind: "unknown" });
    expect(resolveBranchState(undefined)).toEqual({ kind: "unknown" });
    expect(resolveBranchState({ branch: null, error: "Not a git repository" })).toEqual({
      kind: "unknown",
    });
  });
});

describe("shouldShowSyncBadge", () => {
  test("hidden when ahead and behind are both zero (also the no-upstream case)", () => {
    expect(shouldShowSyncBadge({ ahead: 0, behind: 0 })).toBe(false);
  });

  test("shown when either side is non-zero", () => {
    expect(shouldShowSyncBadge({ ahead: 2, behind: 0 })).toBe(true);
    expect(shouldShowSyncBadge({ ahead: 0, behind: 3 })).toBe(true);
  });

  test("hidden for unreadable repositories and missing snapshots", () => {
    expect(shouldShowSyncBadge({ ahead: 1, behind: 1, error: "boom" })).toBe(false);
    expect(shouldShowSyncBadge(null)).toBe(false);
  });
});

describe("stale badge", () => {
  test("shown only when stale is explicitly true", () => {
    expect(shouldShowStaleBadge({ stale: true })).toBe(true);
    expect(shouldShowStaleBadge({ stale: false })).toBe(false);
    expect(shouldShowStaleBadge({})).toBe(false);
    expect(shouldShowStaleBadge(null)).toBe(false);
  });

  test("label includes the time of the last failed read", () => {
    const now = new Date("2026-11-22T12:00:00.000Z");
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    expect(staleBadgeLabel({ lastErrorAt: tenMinutesAgo }, now)).toBe(
      "dane z ostatniego udanego odczytu · błąd 10 min temu",
    );
  });

  test("label omits the time when it is unknown or invalid", () => {
    const base = "dane z ostatniego udanego odczytu";
    expect(staleBadgeLabel({ lastErrorAt: null })).toBe(base);
    expect(staleBadgeLabel({})).toBe(base);
    expect(staleBadgeLabel({ lastErrorAt: "nie-data" })).toBe(base);
  });
});

describe("touched files truncation", () => {
  test("detects the truncation flag", () => {
    expect(isTouchedFilesTruncated({ recentlyTouchedFilesTruncated: true })).toBe(true);
    expect(isTouchedFilesTruncated({ recentlyTouchedFilesTruncated: false })).toBe(false);
    expect(isTouchedFilesTruncated({})).toBe(false);
    expect(isTouchedFilesTruncated(null)).toBe(false);
  });

  test("label names the 200-file limit with correct Polish form", () => {
    expect(touchedFilesTruncationLabel()).toBe("Pokazano pierwsze 200 plików");
    expect(touchedFilesTruncationLabel(1)).toBe("Pokazano pierwsze 1 plik");
    expect(touchedFilesTruncationLabel(3)).toBe("Pokazano pierwsze 3 pliki");
  });
});
