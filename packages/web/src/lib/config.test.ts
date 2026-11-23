import { describe, expect, test } from "bun:test";
import {
  buildConfigPreview,
  buildProjectPatch,
  normalizePathList,
  planDirsBadge,
  projectFormValues,
  validatePathList,
  validateProjectForm,
  validateRelativePath,
} from "./config";

describe("buildConfigPreview", () => {
  test("mirrors the projects section of config.yaml", () => {
    const preview = buildConfigPreview([
      {
        id: "workflow-core",
        relPath: "workflow-core",
        active: true,
        planFiles: ["plan.md", "docs/phase-2.md"],
        agentDocs: ["AGENTS.md"],
      },
    ]);
    expect(preview).toBe(
      [
        "projects:",
        "  - id: workflow-core",
        "    path: workflow-core",
        "    active: true",
        "    plan_files: [plan.md, docs/phase-2.md]",
        "    agent_docs: [AGENTS.md]",
      ].join("\n"),
    );
  });

  test("renders empty lists and no projects", () => {
    expect(buildConfigPreview([])).toBe("projects: []");
    expect(
      buildConfigPreview([
        { id: "a", relPath: "a", active: false, planFiles: [], agentDocs: [] },
      ]),
    ).toContain("    plan_files: []");
  });
});

describe("normalizePathList", () => {
  test("trims, unifies separators and drops blanks and duplicates, keeping the first order", () => {
    expect(
      normalizePathList([" context ", "docs\\plans/", "", "./context", "  ", "docs/plans", "specs"]),
    ).toEqual(["context", "docs/plans", "specs"]);
  });
});

describe("validateRelativePath", () => {
  test("accepts plain relative paths", () => {
    expect(validateRelativePath("context")).toBeNull();
    expect(validateRelativePath("docs/plan.md")).toBeNull();
  });

  test("rejects empty, absolute and parent-escaping paths", () => {
    expect(validateRelativePath("   ")).toMatch(/pusta/);
    expect(validateRelativePath("/etc/context")).toMatch(/bezwzględną/);
    expect(validateRelativePath("C:\\context")).toMatch(/bezwzględną/);
    expect(validateRelativePath("../context")).toMatch(/\.\./);
    expect(validateRelativePath("docs/../../secret")).toMatch(/\.\./);
  });
});

describe("validatePathList", () => {
  test("reports the first invalid entry and ignores duplicates of valid ones", () => {
    expect(validatePathList(["context", "context", "docs"])).toBeNull();
    expect(validatePathList(["context", "../x"])).toMatch(/\.\./);
  });
});

describe("buildProjectPatch", () => {
  const base = {
    name: "Alpha",
    codePrefix: "ALP",
    relPath: "alpha",
    planFiles: ["plan.md"],
    planDirs: ["context", "docs"],
    planDirsOverride: false,
    agentDocs: ["AGENTS.md"],
  };

  test("returns an empty patch when nothing changed (trimmed name counts as unchanged)", () => {
    expect(buildProjectPatch(base, { ...projectFormValues(base), name: "  Alpha  " })).toEqual({});
  });

  test("sends only the changed fields", () => {
    const patch = buildProjectPatch(base, { ...projectFormValues(base), name: "Beta" });
    expect(patch).toEqual({ name: "Beta" });
  });

  test("sends planDirs null when the project returns to config defaults", () => {
    const overridden = { ...base, planDirs: ["specs"], planDirsOverride: true };
    const patch = buildProjectPatch(overridden, { ...projectFormValues(overridden), useDefaultPlanDirs: true });
    expect(patch).toEqual({ planDirs: null });
  });

  test("omits planDirs while the default stays default and the override is untouched", () => {
    const patch = buildProjectPatch(base, projectFormValues(base));
    expect("planDirs" in patch).toBe(false);
  });

  test("sends the list when leaving the default, even if it equals the default", () => {
    const patch = buildProjectPatch(base, { ...projectFormValues(base), useDefaultPlanDirs: false });
    expect(patch).toEqual({ planDirs: ["context", "docs"] });
  });

  test("sends a changed planDirs list and an order change of planFiles", () => {
    const overridden = { ...base, planDirs: ["specs"], planDirsOverride: true };
    expect(
      buildProjectPatch(overridden, { ...projectFormValues(overridden), planDirs: ["specs", "docs"] }),
    ).toEqual({ planDirs: ["specs", "docs"] });
    expect(
      buildProjectPatch(base, { ...projectFormValues(base), planFiles: ["docs/plan.md", "plan.md"] }),
    ).toEqual({ planFiles: ["docs/plan.md", "plan.md"] });
  });
});

describe("validateProjectForm", () => {
  const values = {
    name: "Alpha",
    codePrefix: "ALP",
    relPath: "alpha",
    useDefaultPlanDirs: true,
    planDirs: [],
    planFiles: ["plan.md"],
    agentDocs: ["AGENTS.md"],
  };

  test("accepts a valid form", () => {
    expect(validateProjectForm(values)).toEqual({});
  });

  test("validates plan directories only when the own list is used", () => {
    expect(validateProjectForm({ ...values, planDirs: ["/abs"] })).toEqual({});
    const errors = validateProjectForm({ ...values, useDefaultPlanDirs: false, planDirs: ["/abs"] });
    expect(errors.planDirs).toMatch(/bezwzględną/);
  });

  test("reports empty name, prefix and relPath", () => {
    const errors = validateProjectForm({ ...values, name: " ", codePrefix: "", relPath: "../x" });
    expect(errors.name).toBeDefined();
    expect(errors.codePrefix).toBeDefined();
    expect(errors.relPath).toMatch(/\.\./);
  });
});

describe("planDirsBadge", () => {
  test("labels the list as own only when the row stores an override", () => {
    expect(planDirsBadge({ planDirsOverride: false })).toBe("domyślne");
    expect(planDirsBadge({ planDirsOverride: true })).toBe("własne");
  });
});
