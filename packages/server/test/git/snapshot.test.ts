import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectGitSnapshot,
  parseChangedFiles,
  parseRecentlyTouchedFiles,
} from "../../src/git/snapshot";
import { commitFile, createTempRepo, type TempRepo } from "./test-repo";

describe("collectGitSnapshot", () => {
  let repo: TempRepo;

  test("reads branch, commits and task code from a fresh repository", async () => {
    repo = await createTempRepo();
    try {
      const committed = await commitFile(repo, "a.txt", "a\n", "[WFC-1] test");
      expect(committed.exitCode).toBe(0);

      const snapshot = await collectGitSnapshot(repo.dir);
      expect(snapshot.error).toBeUndefined();
      expect(snapshot.branch).toBe("main");
      expect(snapshot.dirtyFiles).toBe(0);
      expect(snapshot.ahead).toBe(0);
      expect(snapshot.behind).toBe(0);
      expect(snapshot.commits).toHaveLength(1);
      expect(snapshot.commits[0]?.subject).toBe("[WFC-1] test");
      expect(snapshot.commits[0]?.taskCode).toBe("WFC-1");
      expect(snapshot.commits[0]?.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(snapshot.commits[0]?.shortHash).toHaveLength(7);
      expect(snapshot.lastCommit).toEqual(snapshot.commits[0] ?? null);
    } finally {
      await repo.cleanup();
    }
  });

  test("lists the main worktree and counts dirty files", async () => {
    repo = await createTempRepo();
    try {
      await commitFile(repo, "a.txt", "a\n", "initial commit");

      const clean = await collectGitSnapshot(repo.dir);
      expect(clean.worktrees).toHaveLength(1);
      expect(clean.worktrees[0]).toEqual({ path: repo.dir, branch: "main" });

      await repo.write("untracked.txt", "x\n");
      await repo.write("a.txt", "modified\n");

      const dirty = await collectGitSnapshot(repo.dir);
      expect(dirty.dirtyFiles).toBe(2);
    } finally {
      await repo.cleanup();
    }
  });

  test("lists local branches with their last commit and upstream", async () => {
    repo = await createTempRepo();
    try {
      await commitFile(repo, "a.txt", "a\n", "initial commit");
      const headHash = (await repo.git("rev-parse", "--short", "HEAD")).stdout.trim();
      expect((await repo.git("branch", "feature")).exitCode).toBe(0);
      expect((await repo.git("remote", "add", "origin", repo.dir)).exitCode).toBe(0);
      expect((await repo.git("update-ref", "refs/remotes/origin/main", "HEAD")).exitCode).toBe(0);
      expect((await repo.git("branch", "--set-upstream-to=origin/main", "main")).exitCode).toBe(0);

      const snapshot = await collectGitSnapshot(repo.dir);
      expect(snapshot.branches.map((branch) => branch.name).sort()).toEqual(["feature", "main"]);

      const main = snapshot.branches.find((branch) => branch.name === "main");
      expect(main?.lastCommitHash).toBe(headHash);
      expect(main?.lastCommitAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      expect(main?.upstream).toBe("origin/main");

      const feature = snapshot.branches.find((branch) => branch.name === "feature");
      expect(feature?.lastCommitHash).toBe(headHash);
      expect(feature?.upstream).toBeNull();
    } finally {
      await repo.cleanup();
    }
  });

  test("lists modified, added, deleted and untracked files from porcelain status", async () => {
    repo = await createTempRepo();
    try {
      await commitFile(repo, "keep.txt", "keep\n", "initial commit");
      await commitFile(repo, "removed.txt", "bye\n", "add removable");
      await repo.write("keep.txt", "changed\n");
      await repo.write("added.txt", "new\n");
      expect((await repo.git("add", "--", "added.txt")).exitCode).toBe(0);
      expect((await repo.git("rm", "--", "removed.txt")).exitCode).toBe(0);
      await repo.write("untracked.txt", "x\n");

      const snapshot = await collectGitSnapshot(repo.dir);
      expect(snapshot.dirtyFiles).toBe(4);
      expect(snapshot.changedFilesTruncated).toBe(false);
      expect(snapshot.changedFiles).toEqual(
        expect.arrayContaining([
          { path: "keep.txt", status: " M" },
          { path: "added.txt", status: "A " },
          { path: "removed.txt", status: "D " },
          { path: "untracked.txt", status: "??" },
        ]),
      );
      expect(snapshot.changedFiles).toHaveLength(4);
    } finally {
      await repo.cleanup();
    }
  });

  test("collects unique recently touched files newest first", async () => {
    repo = await createTempRepo();
    try {
      await commitFile(repo, "docs/plan.md", "v1\n", "first");
      await commitFile(repo, "src/one.ts", "one\n", "second");
      await commitFile(repo, "docs/plan.md", "v2\n", "third");
      await commitFile(repo, "src/two.ts", "two\n", "fourth");

      const snapshot = await collectGitSnapshot(repo.dir);
      expect(snapshot.recentlyTouchedFiles.map((file) => file.path)).toEqual([
        "src/two.ts",
        "docs/plan.md",
        "src/one.ts",
      ]);

      const newest = (await repo.git("log", "-1", "--format=%aI")).stdout.trim();
      expect(snapshot.recentlyTouchedFiles[0]?.lastChangedAt).toBe(newest);

      const planCommit = (await repo.git("log", "-1", "--format=%aI", "--", "docs/plan.md")).stdout.trim();
      const planFile = snapshot.recentlyTouchedFiles.find((file) => file.path === "docs/plan.md");
      expect(planFile?.lastChangedAt).toBe(planCommit);
    } finally {
      await repo.cleanup();
    }
  });

  test("caps recently touched files at 200 entries", async () => {
    repo = await createTempRepo();
    try {
      const paths = Array.from({ length: 201 }, (_, index) => `f-${String(index).padStart(3, "0")}.txt`);
      for (const filePath of paths) {
        await repo.write(filePath, "x\n");
      }
      expect((await repo.git("add", "--", ".")).exitCode).toBe(0);
      expect((await repo.git("commit", "-m", "many files")).exitCode).toBe(0);

      const snapshot = await collectGitSnapshot(repo.dir);
      expect(snapshot.recentlyTouchedFiles).toHaveLength(200);
      expect(snapshot.recentlyTouchedFilesTruncated).toBe(true);
      expect(snapshot.recentlyTouchedFiles[0]?.path).toBe("f-000.txt");
      expect(snapshot.recentlyTouchedFiles.at(-1)?.path).toBe("f-199.txt");
    } finally {
      await repo.cleanup();
    }
  });

  test("reports truncation only above the recently touched files cap", () => {
    const logOf = (count: number) => {
      const header = `\u001e2026-01-01T00:00:00+00:00`;
      const paths = Array.from({ length: count }, (_, index) => `file-${index}.ts`);
      return [header, ...paths].join("\n");
    };

    const exact = parseRecentlyTouchedFiles(logOf(200));
    expect(exact.files).toHaveLength(200);
    expect(exact.truncated).toBe(false);

    const over = parseRecentlyTouchedFiles(logOf(201));
    expect(over.files).toHaveLength(200);
    expect(over.truncated).toBe(true);
  });

  test("reports a detached HEAD with branch null and branches listed", async () => {
    repo = await createTempRepo();
    try {
      await commitFile(repo, "a.txt", "a\n", "initial commit");
      expect((await repo.git("checkout", "--detach", "HEAD")).exitCode).toBe(0);

      const snapshot = await collectGitSnapshot(repo.dir);
      expect(snapshot.error).toBeUndefined();
      expect(snapshot.branch).toBeNull();
      expect(snapshot.branches.map((branch) => branch.name)).toContain("main");
      expect(snapshot.commits[0]?.subject).toBe("initial commit");
    } finally {
      await repo.cleanup();
    }
  });

  test("copes with a repository without any remote", async () => {
    repo = await createTempRepo();
    try {
      await commitFile(repo, "a.txt", "a\n", "initial commit");

      const snapshot = await collectGitSnapshot(repo.dir);
      expect(snapshot.error).toBeUndefined();
      expect(snapshot.ahead).toBe(0);
      expect(snapshot.behind).toBe(0);
      expect(snapshot.branches).toHaveLength(1);
      expect(snapshot.branches[0]?.upstream).toBeNull();
    } finally {
      await repo.cleanup();
    }
  });

  test("reports a broken repository when .git/HEAD is missing", async () => {
    repo = await createTempRepo();
    try {
      await commitFile(repo, "a.txt", "a\n", "initial commit");
      await rm(path.join(repo.dir, ".git", "HEAD"));

      const snapshot = await collectGitSnapshot(repo.dir);
      expect(snapshot.error).toContain("Broken git repository");
      expect(snapshot.error).toContain("not a git repository");
      expect(snapshot.branch).toBeNull();
      expect(snapshot.commits).toEqual([]);
    } finally {
      await repo.cleanup();
    }
  });

  test("reports a broken repository when .git is not a valid gitfile", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-board-broken-"));
    try {
      await writeFile(path.join(dir, ".git"), "this is not a gitfile\n");

      const snapshot = await collectGitSnapshot(dir);
      expect(snapshot.error).toContain("Broken git repository");
      expect(snapshot.error).toContain("invalid gitfile format");
      expect(snapshot.worktrees).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("caps changed files at 500 entries and reports truncation", () => {
    const porcelain = (count: number) =>
      Array.from({ length: count }, (_, index) => ` M file-${index}.ts`).join("\n");

    const exact = parseChangedFiles(porcelain(500));
    expect(exact.files).toHaveLength(500);
    expect(exact.truncated).toBe(false);
    expect(exact.files[0]).toEqual({ path: "file-0.ts", status: " M" });

    const over = parseChangedFiles(porcelain(501));
    expect(over.files).toHaveLength(500);
    expect(over.truncated).toBe(true);
  });

  test("leaves taskCode null when the subject has no task code", async () => {
    repo = await createTempRepo();
    try {
      await commitFile(repo, "a.txt", "a\n", "chore: no code here");
      const snapshot = await collectGitSnapshot(repo.dir);
      expect(snapshot.commits[0]?.taskCode).toBeNull();
    } finally {
      await repo.cleanup();
    }
  });

  test("returns an empty snapshot for a repository without commits", async () => {
    repo = await createTempRepo();
    try {
      const snapshot = await collectGitSnapshot(repo.dir);
      expect(snapshot.error).toBeUndefined();
      expect(snapshot.commits).toEqual([]);
      expect(snapshot.lastCommit).toBeNull();
      expect(snapshot.branch).toBe("main");
      expect(snapshot.dirtyFiles).toBe(0);
      expect(snapshot.branches).toEqual([]);
      expect(snapshot.changedFiles).toEqual([]);
      expect(snapshot.changedFilesTruncated).toBe(false);
      expect(snapshot.recentlyTouchedFiles).toEqual([]);
    } finally {
      await repo.cleanup();
    }
  });

  test("reports an error instead of throwing for a plain directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-board-plain-"));
    try {
      const snapshot = await collectGitSnapshot(dir);
      expect(snapshot.error).toBeDefined();
      expect(snapshot.error).toContain("Not a git repository");
      expect(snapshot.branch).toBeNull();
      expect(snapshot.commits).toEqual([]);
      expect(snapshot.lastCommit).toBeNull();
      expect(snapshot.branches).toEqual([]);
      expect(snapshot.changedFiles).toEqual([]);
      expect(snapshot.recentlyTouchedFiles).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports an error for a missing path", async () => {
    const snapshot = await collectGitSnapshot(path.join(tmpdir(), "agent-board-missing-does-not-exist"));
    expect(snapshot.error).toContain("does not exist");
    expect(snapshot.worktrees).toEqual([]);
  });
});
