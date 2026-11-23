import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface TempRepo {
  dir: string;
  git: (...args: string[]) => Promise<GitResult>;
  write: (relativePath: string, content: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

export async function runGitCommand(cwd: string, args: string[]): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

/** Creates a throwaway repository under `parentDir` (OS temp by default), already on `main`. */
export async function createTempRepo(parentDir: string = tmpdir()): Promise<TempRepo> {
  const dir = await realpath(await mkdtemp(path.join(parentDir, "agent-board-git-")));
  const git = (...args: string[]) => runGitCommand(dir, args);

  const init = await git("init");
  if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr}`);

  for (const [key, value] of [
    ["user.name", "Agent Board Test"],
    ["user.email", "test@agent-board.local"],
    ["commit.gpgsign", "false"],
    ["core.hooksPath", ""],
  ] as const) {
    const configured = await git("config", key, value);
    if (configured.exitCode !== 0) throw new Error(`git config ${key} failed: ${configured.stderr}`);
  }

  const head = await git("symbolic-ref", "HEAD", "refs/heads/main");
  if (head.exitCode !== 0) throw new Error(`git symbolic-ref failed: ${head.stderr}`);

  return {
    dir,
    git,
    async write(relativePath, content) {
      const target = path.join(dir, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function commitFile(
  repo: TempRepo,
  relativePath: string,
  content: string,
  message: string,
): Promise<GitResult> {
  await repo.write(relativePath, content);
  const added = await repo.git("add", "--", relativePath);
  if (added.exitCode !== 0) throw new Error(`git add failed: ${added.stderr}`);
  return repo.git("commit", "-m", message);
}
