/**
 * Pomiar kosztu `collectGitSnapshot` na dużym repozytorium oraz kosztu
 * jednego przebiegu pollera przy N projektach.
 *
 * Domyślnie: 20 000 plików w 200 katalogach, 500 commitów, 3 worktrees,
 * 50 gałęzi. Snapshot mierzony 5 razy (mediana i max), poller — 5 przebiegów
 * w dwóch wariantach: świeże klony (indeks "racy") i ciepły indeks.
 *
 * Uruchomienie z katalogu agent-board:
 *   bun packages/server/scripts/bench-git.ts
 *   bun packages/server/scripts/bench-git.ts --keep        # zostaw repo
 *   bun packages/server/scripts/bench-git.ts --projects=1  # bez klonów
 *
 * Skrypt sprząta po sobie (rm -rf katalogu tymczasowego), chyba że podano --keep.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, runMigrations } from "../src/db";
import { ConfigSchema } from "../src/config/schema";
import { collectGitSnapshot } from "../src/git/snapshot";
import { refreshAllSnapshots } from "../src/git-poller";
import { clearProjectSnapshots } from "../src/api/projects-state";

interface Options {
  keep: boolean;
  dirs: number;
  filesPerDir: number;
  commits: number;
  filesPerCommit: number;
  worktrees: number;
  branches: number;
  runs: number;
  projects: number;
}

const DEFAULTS: Options = {
  keep: false,
  dirs: 200,
  filesPerDir: 100,
  commits: 500,
  filesPerCommit: 12,
  worktrees: 3,
  branches: 50,
  runs: 5,
  projects: 10,
};

const NUMERIC_FLAGS: Record<string, keyof Options> = {
  "--dirs": "dirs",
  "--files-per-dir": "filesPerDir",
  "--commits": "commits",
  "--files-per-commit": "filesPerCommit",
  "--worktrees": "worktrees",
  "--branches": "branches",
  "--runs": "runs",
  "--projects": "projects",
};

function parseArgs(argv: string[]): Options {
  const options: Options = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg === "--keep") {
      options.keep = true;
      continue;
    }
    const [name, raw] = arg.split("=");
    const key = name === undefined ? undefined : NUMERIC_FLAGS[name];
    if (key === undefined || raw === undefined) throw new Error(`Unknown argument: ${arg}`);
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid value: ${arg}`);
    options[key] = value;
  }
  return options;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} (${cwd}) failed: ${stderr.trim()}`);
  }
  return stdout;
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");
const dirName = (index: number) => `d${pad(index, 3)}`;
const fileName = (index: number) => `f${pad(index, 3)}.txt`;

function fileRelPath(index: number, filesPerDir: number): string {
  return `${dirName(Math.floor(index / filesPerDir))}/${fileName(index % filesPerDir)}`;
}

async function createRepo(options: Options, root: string): Promise<string> {
  const repoDir = path.join(root, "repo");
  await mkdir(repoDir, { recursive: true });

  await git(repoDir, ["init", "-q", "-b", "main"]);
  for (const [key, value] of [
    ["user.name", "Agent Board Bench"],
    ["user.email", "bench@agent-board.local"],
    ["commit.gpgsign", "false"],
    ["core.hooksPath", ""],
  ]) {
    await git(repoDir, ["config", key, value ?? ""]);
  }

  const files = options.dirs * options.filesPerDir;
  process.stderr.write(`[bench] tworzę ${files} plików w ${options.dirs} katalogach...\n`);
  for (let dirIndex = 0; dirIndex < options.dirs; dirIndex += 1) {
    const dirPath = path.join(repoDir, dirName(dirIndex));
    await mkdir(dirPath, { recursive: true });
    const writes: Promise<void>[] = [];
    for (let fileIndex = 0; fileIndex < options.filesPerDir; fileIndex += 1) {
      const target = path.join(dirPath, fileName(fileIndex));
      writes.push(writeFile(target, `seed ${dirIndex}/${fileIndex}\n`));
    }
    await Promise.all(writes);
  }
  await git(repoDir, ["add", "-A"]);
  await git(repoDir, ["commit", "-q", "-m", "[BNC-0] seed large repository"]);

  process.stderr.write(`[bench] tworzę ${options.commits} commitów...\n`);
  for (let commit = 1; commit <= options.commits; commit += 1) {
    const touched: string[] = [];
    for (let offset = 0; offset < options.filesPerCommit && files > 0; offset += 1) {
      const relPath = fileRelPath((commit * options.filesPerCommit + offset) % files, options.filesPerDir);
      await writeFile(path.join(repoDir, relPath), `commit ${commit} file ${relPath}\n`);
      touched.push(relPath);
    }
    await git(repoDir, ["add", "--", ...touched]);
    await git(repoDir, [
      "commit",
      "-q",
      "-m",
      `[BNC-${commit}] touch ${touched.length} files`,
    ]);
    if (commit % 100 === 0) process.stderr.write(`[bench]   ${commit}/${options.commits}\n`);
  }

  for (let index = 1; index <= options.worktrees; index += 1) {
    await git(repoDir, [
      "worktree",
      "add",
      "-q",
      path.join(root, `wt-${index}`),
      "-b",
      `bench-wt-${index}`,
    ]);
  }

  for (let index = 1; index <= options.branches; index += 1) {
    await git(repoDir, ["branch", `bench-branch-${index}`]);
  }

  return repoDir;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

const ms = (value: number) => `${value.toFixed(1)} ms`;

function report(label: string, durations: number[]): void {
  console.log(
    `${label}: median=${ms(median(durations))} max=${ms(Math.max(...durations))} ` +
      `min=${ms(Math.min(...durations))} runs=[${durations.map(ms).join(", ")}]`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const root = await mkdtemp(path.join(tmpdir(), "agent-board-bench-"));
  console.log(
    `[bench] root=${root} files=${options.dirs * options.filesPerDir} dirs=${options.dirs} ` +
      `commits=${options.commits} worktrees=${options.worktrees} branches=${options.branches}`,
  );

  let totalStart = performance.now();
  const repoDir = await createRepo(options, root);
  console.log(`[bench] repo gotowe w ${ms(performance.now() - totalStart)}`);

  const tracked = (await git(repoDir, ["ls-files"])).trim().split("\n").filter(Boolean).length;
  console.log(`[bench] git ls-files=${tracked}`);

  const snapshotDurations: number[] = [];
  const samples: Awaited<ReturnType<typeof collectGitSnapshot>>[] = [];
  for (let run = 1; run <= options.runs; run += 1) {
    const start = performance.now();
    samples.push(await collectGitSnapshot(repoDir));
    snapshotDurations.push(performance.now() - start);
  }
  const sample = samples[samples.length - 1];
  report("collectGitSnapshot", snapshotDurations);
  if (sample) {
    console.log(
      `[bench] snapshot: branch=${sample.branch} commits=${sample.commits.length} ` +
        `branches=${sample.branches.length} worktrees=${sample.worktrees.length} ` +
        `dirtyFiles=${sample.dirtyFiles} changedFiles=${sample.changedFiles.length} ` +
        `recentlyTouched=${sample.recentlyTouchedFiles.length}` +
        `(truncated=${sample.recentlyTouchedFilesTruncated}) error=${sample.error ?? "none"}`,
    );
  }

  if (options.projects <= 1) {
    console.log("[bench] poller: pominięty (--projects=1), potrzebny co najmniej 1 projekt na klon");
  } else {
    totalStart = performance.now();
    const projectDirs = [repoDir];
    for (let index = 2; index <= options.projects; index += 1) {
      const target = path.join(root, `repo-copy-${index}`);
      await git(root, ["clone", "--local", "--quiet", repoDir, target]);
      projectDirs.push(target);
    }
    console.log(
      `[bench] ${projectDirs.length} repozytoriów gotowych w ${ms(performance.now() - totalStart)}`,
    );

    const db = openDatabase(":memory:");
    runMigrations(db);
    const insert = db.prepare(
      `INSERT INTO projects (id, code_prefix, name, rel_path, plan_files_json, agent_docs_json, plan_hashes_json, next_task_seq, active, created_at)
       VALUES (?, ?, ?, ?, '[]', '[]', '{}', 1, 1, ?)`,
    );
    const now = new Date().toISOString();
    for (const [index, dir] of projectDirs.entries()) {
      insert.run(`bench-${index + 1}`, `BNC${index + 1}`, `Bench ${index + 1}`, path.relative(root, dir), now);
    }

    const config = ConfigSchema.parse({ workspace_root: root });
    const measurePoller = async (): Promise<number[]> => {
      const durations: number[] = [];
      for (let run = 1; run <= options.runs; run += 1) {
        const start = performance.now();
        const updated = await refreshAllSnapshots(db, config);
        durations.push(performance.now() - start);
        if (updated !== projectDirs.length) {
          console.warn(`[bench] uwaga: przebieg ${run} zaktualizował ${updated}/${projectDirs.length}`);
        }
      }
      return durations;
    };

    // Świeży klon ma indeks "racy": git --no-optional-locks go nie odświeża,
    // więc `git status` porównuje treść plików. To realny koszt zaraz po klonie.
    const coldDurations = await measurePoller();
    report(`refreshAllSnapshots (${projectDirs.length} projektów, świeże klony)`, coldDurations);

    // Zwykły `git status` zapisuje odświeżony indeks — symuluje repo, w którym
    // deweloper już pracował (indeks ciepły). Nie zmieniamy samych plików.
    for (const dir of projectDirs) await git(dir, ["status", "--porcelain"]);
    const warmDurations = await measurePoller();
    report(`refreshAllSnapshots (${projectDirs.length} projektów, ciepły indeks)`, warmDurations);

    for (const [label, durations] of [
      ["świeże klony", coldDurations],
      ["ciepły indeks", warmDurations],
    ] as const) {
      console.log(
        `[bench] poller (${label}): na projekt median=${ms(median(durations) / projectDirs.length)}`,
      );
    }

    clearProjectSnapshots();
    db.close();
  }

  if (options.keep) {
    console.log(`[bench] --keep: repozytoria zostawione w ${root}`);
    return;
  }
  await rm(root, { recursive: true, force: true });
  console.log("[bench] posprzątane");
}

await main();
