import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, runMigrations } from "../src/db";
import { ConfigSchema } from "../src/config/schema";
import { refreshAllSnapshots, resolveWorkspaceRoot } from "../src/git-poller";
import { getProjectSnapshot, clearProjectSnapshots } from "../src/api/projects-state";
import { commitFile, createTempRepo, type TempRepo } from "./git/test-repo";

const repos: TempRepo[] = [];
const dirs: string[] = [];

// `bun test` z katalogu głównego wczytuje `.env`, więc WORKSPACE_PATH trzeba odizolować.
const initialWorkspaceEnv = process.env.WORKSPACE_PATH;

beforeEach(() => {
  delete process.env.WORKSPACE_PATH;
});

afterAll(() => {
  if (initialWorkspaceEnv === undefined) delete process.env.WORKSPACE_PATH;
  else process.env.WORKSPACE_PATH = initialWorkspaceEnv;
});

afterEach(async () => {
  clearProjectSnapshots();
  for (const repo of repos.splice(0)) await repo.cleanup();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function registerProject(
  db: ReturnType<typeof openDatabase>,
  id: string,
  relPath: string,
  active = true,
): void {
  db.prepare(
    `INSERT INTO projects (id, code_prefix, name, rel_path, plan_files_json, agent_docs_json, plan_hashes_json, next_task_seq, active, created_at)
     VALUES (?, ?, ?, ?, '[]', '[]', '{}', 1, ?, ?)`,
  ).run(id, id.toUpperCase(), id, relPath, active ? 1 : 0, new Date().toISOString());
}

describe("git-poller", () => {
  test("WORKSPACE_PATH wygrywa z workspace_root, config zostaje fallbackiem", () => {
    const previous = process.env.WORKSPACE_PATH;
    const config = ConfigSchema.parse({ workspace_root: "/from/config" });

    try {
      delete process.env.WORKSPACE_PATH;
      expect(resolveWorkspaceRoot(config)).toBe("/from/config");
      expect(resolveWorkspaceRoot(ConfigSchema.parse({}))).toBeNull();

      process.env.WORKSPACE_PATH = "/from/env";
      expect(resolveWorkspaceRoot(config)).toBe("/from/env");
      expect(resolveWorkspaceRoot(ConfigSchema.parse({}))).toBe("/from/env");

      process.env.WORKSPACE_PATH = "   ";
      expect(resolveWorkspaceRoot(config)).toBe("/from/config");
    } finally {
      if (previous === undefined) delete process.env.WORKSPACE_PATH;
      else process.env.WORKSPACE_PATH = previous;
    }
  });

  test("odświeża snapshoty tylko aktywnych projektów", async () => {
    const repo = await createTempRepo();
    repos.push(repo);
    await commitFile(repo, "plan.md", "# Demo", "[WFC-1] start");

    const workspace = path.dirname(repo.dir);
    const relPath = path.basename(repo.dir);
    const db = openDatabase(":memory:");
    runMigrations(db);

    registerProject(db, "demo", relPath);
    registerProject(db, "off", "definitely-missing", false);

    const config = ConfigSchema.parse({ workspace_root: workspace });
    const updated = await refreshAllSnapshots(db, config);

    expect(updated).toBe(1);
    expect(getProjectSnapshot("demo")?.branch ?? "main").toBe("main");
    expect(getProjectSnapshot("demo")?.commits?.[0]?.taskCode).toBe("WFC-1");
    expect(getProjectSnapshot("off")).toBeUndefined();
    db.close();
  });

  test("błąd odczytu zachowuje poprzedni snapshot i oznacza go jako stale", async () => {
    const repo = await createTempRepo();
    repos.push(repo);
    await commitFile(repo, "plan.md", "# Demo", "[WFC-1] start");

    const workspace = path.dirname(repo.dir);
    const db = openDatabase(":memory:");
    runMigrations(db);
    registerProject(db, "demo", path.basename(repo.dir));

    const config = ConfigSchema.parse({ workspace_root: workspace });
    expect(await refreshAllSnapshots(db, config)).toBe(1);

    const good = getProjectSnapshot("demo");
    expect(good?.error).toBeUndefined();
    expect(good?.stale).toBeUndefined();

    await rm(path.join(repo.dir, ".git", "HEAD"));
    expect(await refreshAllSnapshots(db, config)).toBe(0);

    const stale = getProjectSnapshot("demo");
    expect(stale).toBeDefined();
    expect(stale?.stale).toBe(true);
    expect(stale?.error).toBeUndefined();
    expect(typeof stale?.lastErrorAt).toBe("string");
    expect(Number.isNaN(Date.parse(stale?.lastErrorAt ?? ""))).toBe(false);
    expect(stale?.lastError).toContain("Broken git repository");
    expect(stale?.commits).toEqual(good?.commits);
    expect(stale?.branch).toBe("main");
    expect(stale?.lastCommit).toEqual(good?.lastCommit);

    // A later successful refresh replaces the snapshot and clears the stale flag.
    await writeFile(path.join(repo.dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    expect(await refreshAllSnapshots(db, config)).toBe(1);
    const fresh = getProjectSnapshot("demo");
    expect(fresh?.stale).toBeUndefined();
    expect(fresh?.lastErrorAt).toBeUndefined();
    db.close();
  });

  test("pierwszy nieudany odczyt zapisuje snapshot z błędem", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-board-poll-broken-"));
    dirs.push(root);
    const brokenDir = path.join(root, "broken");
    await mkdir(brokenDir);
    await writeFile(path.join(brokenDir, ".git"), "garbage\n");

    const db = openDatabase(":memory:");
    runMigrations(db);
    registerProject(db, "broken", "broken");

    const config = ConfigSchema.parse({ workspace_root: root });
    expect(await refreshAllSnapshots(db, config)).toBe(0);

    const snapshot = getProjectSnapshot("broken");
    expect(snapshot?.error).toContain("Broken git repository");
    expect(snapshot?.stale).toBeUndefined();
    db.close();
  });

  test("błąd jednego repo nie zatrzymuje pętli i nie rusza poprzednich snapshotów", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-board-poller-"));
    dirs.push(root);
    const brokenDir = path.join(root, "broken");
    await mkdir(brokenDir);
    await writeFile(path.join(brokenDir, ".git"), "garbage\n");

    const good = await createTempRepo(root);
    repos.push(good);
    await commitFile(good, "plan.md", "# Good", "initial commit");

    const db = openDatabase(":memory:");
    runMigrations(db);
    registerProject(db, "broken", "broken");
    registerProject(db, "good", path.basename(good.dir));

    const config = ConfigSchema.parse({ workspace_root: root });
    expect(await refreshAllSnapshots(db, config)).toBe(1);

    expect(getProjectSnapshot("broken")?.error).toContain("Broken git repository");
    expect(getProjectSnapshot("good")?.error).toBeUndefined();
    expect(getProjectSnapshot("good")?.commits).toHaveLength(1);
    db.close();
  });
});
