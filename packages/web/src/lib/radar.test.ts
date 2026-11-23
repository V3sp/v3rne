import { describe, expect, test } from "bun:test";
import type { Task } from "@v3rne/shared";
import type { PlanState, ProjectWithGit } from "../api/types";
import { countOpenDoubts, summarizeRadar, type RadarEntry } from "./radar";

function makeProject(overrides: Partial<ProjectWithGit> = {}): ProjectWithGit {
  return {
    id: "workflow-core",
    codePrefix: "WFC",
    name: "Workflow Core",
    relPath: "workflow-core",
    planFiles: ["plan.md"],
    planDirs: [],
    planDirsOverride: false,
    agentDocs: ["AGENTS.md"],
    planHashes: {},
    nextTaskSeq: 1,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    git: null,
    ...overrides,
  };
}

function makeTask(status: Task["status"], index: number): Task {
  return {
    id: index,
    projectId: "workflow-core",
    code: `WFC-${index}`,
    title: `Task ${index}`,
    description: "",
    planFile: null,
    planSection: null,
    status,
    priority: "medium",
    sortOrder: 0,
    claimedBy: null,
    gitBranch: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
  };
}

function makePlan(drift: boolean): PlanState {
  return {
    projectId: "workflow-core",
    drift,
    truncated: false,
    files: [
      { path: "plan.md", origin: "file", exists: true, driftStatus: drift ? "drift" : "clean" },
    ],
  };
}

describe("summarizeRadar", () => {
  test("aggregates KPIs across active projects only", () => {
    const entries: RadarEntry[] = [
      {
        project: makeProject({ id: "workflow-core" }),
        tasks: [
          makeTask("done", 1),
          makeTask("needs_input", 2),
          makeTask("ready", 3),
          makeTask("cancelled", 4),
        ],
        plan: makePlan(true),
      },
      {
        project: makeProject({ id: "mobile", codePrefix: "MOB", active: false }),
        tasks: [makeTask("needs_input", 5), makeTask("done", 6)],
        plan: makePlan(true),
      },
      {
        project: makeProject({ id: "transit", codePrefix: "TRW" }),
        tasks: [makeTask("done", 7)],
        plan: makePlan(false),
      },
    ];

    expect(summarizeRadar(entries)).toEqual({
      monitored: 2,
      progress: { done: 2, total: 4, percent: 50 },
      openDoubts: 1,
      driftAlerts: 1,
    });
  });

  test("unavailable tasks and plans count as zero instead of failing", () => {
    const entries: RadarEntry[] = [{ project: makeProject(), tasks: null, plan: null }];
    expect(summarizeRadar(entries)).toEqual({
      monitored: 1,
      progress: { done: 0, total: 0, percent: 0 },
      openDoubts: 0,
      driftAlerts: 0,
    });
  });

  test("empty registry yields zeroed KPIs", () => {
    expect(summarizeRadar([])).toEqual({
      monitored: 0,
      progress: { done: 0, total: 0, percent: 0 },
      openDoubts: 0,
      driftAlerts: 0,
    });
  });
});

describe("countOpenDoubts", () => {
  test("counts needs_input tasks and tolerates missing data", () => {
    expect(countOpenDoubts([makeTask("needs_input", 1), makeTask("ready", 2)])).toBe(1);
    expect(countOpenDoubts(null)).toBe(0);
  });
});
