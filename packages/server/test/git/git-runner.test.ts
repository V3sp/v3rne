import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gitSubcommand, runGit } from "../../src/git/git-runner";
import { createTempRepo } from "./test-repo";

describe("runGit", () => {
  test("always passes --no-optional-locks as the first git argument", async () => {
    const repo = await createTempRepo();
    try {
      const result = await runGit(["--version"], { cwd: repo.dir });
      expect(result.command[0]).toBe("git");
      expect(result.command[1]).toBe("--no-optional-locks");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("git version");
      expect(result.attempts).toBe(1);
    } finally {
      await repo.cleanup();
    }
  });

  test("returns a non-zero result for a non-repository directory instead of throwing", async () => {
    const missing = path.join(tmpdir(), "agent-board-missing-cwd-does-not-exist");
    const result = await runGit(["rev-parse", "--git-dir"], { cwd: missing });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.timedOut).toBe(false);
    expect(result.attempts).toBe(1);
  });

  test("kills a command that exceeds the timeout and retries it twice", async () => {
    const repo = await createTempRepo();
    try {
      const result = await runGit(["-c", "alias.slow=!sleep 1", "slow"], {
        cwd: repo.dir,
        timeoutMs: 100,
      });
      // `-c` aliases are not in the retryable set.
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("timed out");
      expect(result.attempts).toBe(1);
    } finally {
      await repo.cleanup();
    }
  });

  test("retries a retryable subcommand on timeout and reports the attempts", async () => {
    const repo = await createTempRepo();
    try {
      const result = await runGit(["status", "--porcelain"], {
        cwd: repo.dir,
        // Smaller than the git process startup, so every attempt times out.
        timeoutMs: 1,
      });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      expect(result.attempts).toBe(3);
    } finally {
      await repo.cleanup();
    }
  });

  test("retries log, for-each-ref and worktree as well", async () => {
    const repo = await createTempRepo();
    try {
      for (const args of [
        ["log", "-n", "1"],
        ["for-each-ref", "refs/heads"],
        ["worktree", "list", "--porcelain"],
      ]) {
        const result = await runGit(args, { cwd: repo.dir, timeoutMs: 1 });
        expect({ args, attempts: result.attempts }).toEqual({ args, attempts: 3 });
      }
    } finally {
      await repo.cleanup();
    }
  });

  test("does not retry a permanent 'not a git repository' error", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-board-plain-"));
    try {
      const result = await runGit(["status", "--porcelain"], { cwd: dir });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/not a git repository/i);
      expect(result.attempts).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("finds the subcommand behind global options", () => {
    expect(gitSubcommand(["status", "--porcelain"])).toBe("status");
    expect(gitSubcommand(["-c", "core.quotePath=false", "log", "-n", "1"])).toBe("log");
    expect(gitSubcommand(["--git-dir", ".git", "worktree", "list"])).toBe("worktree");
    expect(gitSubcommand(["--version"])).toBeUndefined();
  });
});
