import { describe, expect, test } from "bun:test";
import path from "node:path";
import { readPlanFiles, validateRelativePath } from "../../src/git/plan-files";
import { sha256Hex } from "../../src/git/plan-hash";
import { createTempRepo, commitFile, type TempRepo } from "./test-repo";

const PLAN = "# Plan\n\n## Faza 1: Fundament\n";

describe("readPlanFiles", () => {
  let repo: TempRepo;

  test("reads a plan file with hash and headings", async () => {
    repo = await createTempRepo();
    try {
      await repo.write("docs/plan.md", PLAN);
      const [file] = await readPlanFiles(repo.dir, ["docs/plan.md"]);

      expect(file?.exists).toBe(true);
      expect(file?.error).toBeUndefined();
      expect(file?.content).toBe(PLAN);
      expect(file?.hash).toBe(sha256Hex(PLAN));
      expect(file?.headings.map((h) => h.slug)).toEqual(["plan", "faza-1-fundament"]);
    } finally {
      await repo.cleanup();
    }
  });

  test("reports a missing file through exists=false, without throwing", async () => {
    repo = await createTempRepo();
    try {
      const [file] = await readPlanFiles(repo.dir, ["plan.md"]);
      expect(file).toEqual({
        path: "plan.md",
        exists: false,
        content: null,
        hash: null,
        headings: [],
      });
    } finally {
      await repo.cleanup();
    }
  });

  test("rejects paths escaping the repository root", async () => {
    repo = await createTempRepo();
    try {
      const results = await readPlanFiles(repo.dir, ["../secret.md", "docs/../../secret.md", "/etc/passwd"]);

      for (const result of results) {
        expect(result.exists).toBe(false);
        expect(result.content).toBeNull();
        expect(result.hash).toBeNull();
        expect(result.error).toBeDefined();
      }
      expect(results[0]?.error).toContain("escapes");
      expect(results[1]?.error).toContain("escapes");
      expect(results[2]?.error).toContain("relative");
    } finally {
      await repo.cleanup();
    }
  });

  test("keeps the requested path in the result", async () => {
    repo = await createTempRepo();
    try {
      const results = await readPlanFiles(repo.dir, ["plan.md", "docs/plan.md"]);
      expect(results.map((r) => r.path)).toEqual(["plan.md", "docs/plan.md"]);
    } finally {
      await repo.cleanup();
    }
  });
});

describe("validateRelativePath", () => {
  const root = path.resolve("/repo");

  test("accepts nested relative paths", () => {
    expect(validateRelativePath(root, "plan.md")).toBeNull();
    expect(validateRelativePath(root, "docs/phase-2.md")).toBeNull();
  });

  test("rejects traversal and absolute paths", () => {
    expect(validateRelativePath(root, "../plan.md")).toContain("escapes");
    expect(validateRelativePath(root, "docs/../../plan.md")).toContain("escapes");
    expect(validateRelativePath(root, "/repo/plan.md")).toContain("relative");
    expect(validateRelativePath(root, "")).toContain("empty");
    expect(validateRelativePath(root, ".")).toContain("root");
  });
});

describe("readPlanFiles — duplikaty ścieżek", () => {
  test("plan.md i PLAN.md czytane raz (systemy niewrażliwe na wielkość liter)", async () => {
    const repo = await createTempRepo();
    try {
      await commitFile(repo, "plan.md", "# Plan\n\n## Sekcja\n", "[ABC-1] plan");
      const files = await readPlanFiles(repo.dir, ["plan.md", "PLAN.md", "docs/plan.md"]);
      expect(files).toHaveLength(2);
      expect(files.filter((file) => file.exists)).toHaveLength(1);
      expect(files[0].headings.map((heading) => heading.title)).toEqual(["Plan", "Sekcja"]);
    } finally {
      await repo.cleanup();
    }
  });
});
