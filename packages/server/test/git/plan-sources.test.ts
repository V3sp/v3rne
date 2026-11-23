import { describe, expect, test } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { resolvePlanSources } from "../../src/git/plan-sources";
import { createTempRepo, type TempRepo } from "./test-repo";

const EXCLUDE = ["archive", "node_modules", ".git"];

async function withRepo(run: (repo: TempRepo) => Promise<void>): Promise<void> {
  const repo = await createTempRepo();
  try {
    await run(repo);
  } finally {
    await repo.cleanup();
  }
}

describe("resolvePlanSources", () => {
  test("adds *.md from plan dirs, skips archive and files outside the dirs", async () => {
    await withRepo(async (repo) => {
      await repo.write("context/foundation/prd.md", "# PRD\n");
      await repo.write("context/foundation/shape-notes.md", "# Notatki\n");
      await repo.write("context/archive/old.md", "# Stary plan\n");
      await repo.write("context/node_modules/pkg/readme.md", "# Paczka\n");
      await repo.write("README.md", "# Repo\n");

      const result = await resolvePlanSources(repo.dir, {
        planFiles: ["plan.md"],
        planDirs: ["context", "docs"],
        excludeDirs: EXCLUDE,
      });

      expect(result.files).toEqual([
        "plan.md",
        "context/foundation/prd.md",
        "context/foundation/shape-notes.md",
      ]);
      expect(result.truncated).toBe(false);
    });
  });

  test("keeps explicit plan files even when they do not exist", async () => {
    await withRepo(async (repo) => {
      const result = await resolvePlanSources(repo.dir, {
        planFiles: ["plan.md", "docs/PRD.md"],
        planDirs: ["context"],
        excludeDirs: EXCLUDE,
      });

      expect(result.files).toEqual(["plan.md", "docs/PRD.md"]);
    });
  });

  test("treats missing plan dirs as empty and never throws", async () => {
    await withRepo(async (repo) => {
      const result = await resolvePlanSources(repo.dir, {
        planFiles: [],
        planDirs: ["context", "docs", "missing/deep"],
        excludeDirs: EXCLUDE,
      });

      expect(result).toEqual({ files: [], truncated: false });
    });
  });

  test("stops at depth 3 and ignores deeper files", async () => {
    await withRepo(async (repo) => {
      await repo.write("context/a/b/c/three.md", "# Trzy\n");
      await repo.write("context/a/b/c/d/four.md", "# Cztery\n");

      const result = await resolvePlanSources(repo.dir, {
        planFiles: [],
        planDirs: ["context"],
        excludeDirs: EXCLUDE,
      });

      expect(result.files).toEqual(["context/a/b/c/three.md"]);
    });
  });

  test("does not follow directory symlinks", async () => {
    await withRepo(async (repo) => {
      await repo.write("outside/hidden.md", "# Ukryty\n");
      await mkdir(path.join(repo.dir, "context"), { recursive: true });
      await symlink(path.join(repo.dir, "outside"), path.join(repo.dir, "context", "linked"));

      const result = await resolvePlanSources(repo.dir, {
        planFiles: [],
        planDirs: ["context"],
        excludeDirs: EXCLUDE,
      });

      expect(result.files).toEqual([]);
    });
  });

  test("deduplicates case-insensitively and keeps the explicit spelling", async () => {
    await withRepo(async (repo) => {
      await repo.write("context/prd.md", "# PRD\n");

      const result = await resolvePlanSources(repo.dir, {
        planFiles: ["context/PRD.md"],
        planDirs: ["context"],
        excludeDirs: EXCLUDE,
      });

      expect(result.files).toEqual(["context/PRD.md"]);
    });
  });

  test("caps the list and reports truncated", async () => {
    await withRepo(async (repo) => {
      for (const name of ["a", "b", "c"]) {
        await repo.write(`context/${name}.md`, `# ${name}\n`);
      }

      const result = await resolvePlanSources(repo.dir, {
        planFiles: [],
        planDirs: ["context"],
        excludeDirs: EXCLUDE,
        maxFiles: 2,
      });

      expect(result.files).toEqual(["context/a.md", "context/b.md"]);
      expect(result.truncated).toBe(true);
    });
  });

  test("counts explicit files towards the limit", async () => {
    await withRepo(async (repo) => {
      await repo.write("context/a.md", "# a\n");

      const result = await resolvePlanSources(repo.dir, {
        planFiles: ["plan.md"],
        planDirs: ["context"],
        excludeDirs: EXCLUDE,
        maxFiles: 1,
      });

      expect(result.files).toEqual(["plan.md"]);
      expect(result.truncated).toBe(true);
    });
  });
});
