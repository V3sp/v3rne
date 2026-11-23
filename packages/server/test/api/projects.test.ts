import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { Project } from "@v3rne/shared";
import { clearProjectSnapshots, getProjectSnapshot } from "../../src/api/projects-state";
import {
  createProjectsRouter,
  type DiscoveredRepo,
  type PlanState,
  type ProjectWithGit,
} from "../../src/api/projects";
import { ConfigSchema } from "../../src/config/schema";
import { openDatabase, runMigrations } from "../../src/db";
import { runGitCommand } from "../git/test-repo";

interface ErrorBody {
  error: { code: string; message: string };
}

interface DocsBody {
  projectId: string;
  files: Array<{ path: string; exists: boolean; content: string | null; error?: string }>;
}

const DEFAULT_PLAN_FILES = ["plan.md", "PLAN.md", "docs/plan.md", "docs/PRD.md"];
const DEFAULT_PLAN_DIRS = ["context", "docs"];
const DEFAULT_AGENT_DOCS = ["AGENTS.md", "CLAUDE.md", "README_AI.md", ".cursorrules"];

let workspace: string;
let db: Database;
let app: Hono;

beforeEach(async () => {
  workspace = await realpath(await mkdtemp(path.join(tmpdir(), "agent-board-api-")));
  // Repo directories used by the cases below must exist: POST/PATCH reject missing paths.
  for (const dir of [
    "repos/alpha",
    "repos/Alpha",
    "repos/alpine",
    "repos/beta",
    "repos/other",
    "repos/probe",
    "REPOS/ALPHA",
    "repo-a",
    "repo-b",
  ]) {
    await mkdir(path.join(workspace, dir), { recursive: true });
  }
  db = openDatabase(":memory:");
  runMigrations(db);
  app = new Hono();
  app.route(
    "/api/v1",
    createProjectsRouter({ db, config: ConfigSchema.parse({ workspace_root: workspace }) }),
  );
  clearProjectSnapshots();
});

afterEach(async () => {
  db.close();
  await rm(workspace, { recursive: true, force: true });
});

async function api(method: string, pathname: string, body?: unknown): Promise<Response> {
  return app.request(`/api/v1${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createProjectOK(overrides: Record<string, unknown> = {}): Promise<Project> {
  const response = await api("POST", "/projects", {
    id: "alpha",
    codePrefix: "ALP",
    name: "Alpha",
    relPath: "repos/alpha",
    ...overrides,
  });
  if (response.status !== 201) {
    throw new Error(`expected 201, got ${response.status}: ${await response.text()}`);
  }
  return json<Project>(response);
}

async function initRepo(relPath: string): Promise<string> {
  const dir = path.join(workspace, relPath);
  await mkdir(dir, { recursive: true });

  const init = await runGitCommand(dir, ["init"]);
  if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr}`);

  for (const [key, value] of [
    ["user.name", "Agent Board Test"],
    ["user.email", "test@agent-board.local"],
    ["commit.gpgsign", "false"],
  ] as const) {
    const configured = await runGitCommand(dir, ["config", key, value]);
    if (configured.exitCode !== 0) throw new Error(`git config ${key} failed: ${configured.stderr}`);
  }

  const head = await runGitCommand(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  if (head.exitCode !== 0) throw new Error(`git symbolic-ref failed: ${head.stderr}`);

  return dir;
}

async function writeWorkspaceFile(relPath: string, content: string): Promise<void> {
  const target = path.join(workspace, relPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

describe("projects API", () => {
  test("GET /projects is empty before any project is created", async () => {
    const response = await api("GET", "/projects");
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ projects: [] });
  });

  test("POST /projects falls back to config defaults and lists the project", async () => {
    const project = await createProjectOK();

    expect(project.id).toBe("alpha");
    expect(project.codePrefix).toBe("ALP");
    expect(project.name).toBe("Alpha");
    expect(project.relPath).toBe("repos/alpha");
    expect(project.planFiles).toEqual(DEFAULT_PLAN_FILES);
    expect(project.planDirs).toEqual(DEFAULT_PLAN_DIRS);
    expect(project.planDirsOverride).toBe(false);
    expect(project.agentDocs).toEqual(DEFAULT_AGENT_DOCS);
    expect(project.planHashes).toEqual({});
    expect(project.nextTaskSeq).toBe(1);
    expect(project.active).toBe(true);
    expect(Number.isNaN(Date.parse(project.createdAt))).toBe(false);
    expect(project.createdAt.endsWith("Z")).toBe(true);

    const list = await json<{ projects: ProjectWithGit[] }>(await api("GET", "/projects"));
    expect(list.projects).toHaveLength(1);
    expect(list.projects[0]?.id).toBe("alpha");
    expect(list.projects[0]?.git).toBeNull();
  });

  test("POST /projects accepts explicit planFiles, agentDocs and active", async () => {
    const project = await createProjectOK({
      planFiles: ["plan.md", "docs/phase-2.md"],
      agentDocs: ["AGENTS.md"],
      active: false,
    });

    expect(project.planFiles).toEqual(["plan.md", "docs/phase-2.md"]);
    expect(project.agentDocs).toEqual(["AGENTS.md"]);
    expect(project.active).toBe(false);
  });

  test("POST /projects rejects invalid bodies with 400", async () => {
    const base = { id: "probe", codePrefix: "PRB", name: "Probe", relPath: "repos/probe" };
    const cases: Array<[string, Record<string, unknown>]> = [
      ["lowercase codePrefix", { codePrefix: "prb" }],
      ["too long codePrefix", { codePrefix: "ABCDEF" }],
      ["too short codePrefix", { codePrefix: "P" }],
      ["non-slug id", { id: "Probe Repo" }],
      ["absolute relPath", { relPath: "/tmp/probe" }],
      ["escaping relPath", { relPath: "../probe" }],
      ["escaping planFile", { planFiles: ["../secret.md"] }],
      ["escaping planDir", { planDirs: ["../context"] }],
      ["absolute planDir", { planDirs: ["/tmp/context"] }],
      ["absolute agentDoc", { agentDocs: ["/etc/passwd"] }],
      ["unknown field", { extra: true }],
    ];

    for (const [label, patch] of cases) {
      const response = await api("POST", "/projects", { ...base, ...patch });
      const body = await json<ErrorBody>(response);
      expect({ label, status: response.status }).toEqual({ label, status: 400 });
      expect({ label, code: body.error.code }).toEqual({ label, code: "invalid_request" });
    }

    const malformed = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect((await json<ErrorBody>(malformed)).error.code).toBe("invalid_json");
  });

  test("POST /projects rejects duplicate id and relPath with 409", async () => {
    await createProjectOK();

    const duplicateId = await api("POST", "/projects", {
      id: "alpha",
      codePrefix: "OTH",
      name: "Other Alpha",
      relPath: "repos/other",
    });
    expect(duplicateId.status).toBe(409);
    expect((await json<ErrorBody>(duplicateId)).error.code).toBe("id_taken");

    const duplicatePath = await api("POST", "/projects", {
      id: "beta",
      codePrefix: "BET",
      name: "Beta",
      relPath: "repos/alpha",
    });
    expect(duplicatePath.status).toBe(409);
    expect((await json<ErrorBody>(duplicatePath)).error.code).toBe("rel_path_taken");
  });

  test("normalizes relPath on create and patch without changing its case", async () => {
    const created = await createProjectOK({ relPath: "  repos\\Alpha/  " });
    expect(created.relPath).toBe("repos/Alpha");

    const patched = await api("PATCH", "/projects/alpha", { relPath: "repos\\alpine//" });
    expect(patched.status).toBe(200);
    expect((await json<Project>(patched)).relPath).toBe("repos/alpine");

    const badPatch = await api("PATCH", "/projects/alpha", { relPath: "../escape/" });
    expect(badPatch.status).toBe(400);
    expect((await json<ErrorBody>(badPatch)).error.code).toBe("invalid_request");
  });

  test("relPath must point at an existing directory under the workspace", async () => {
    await createProjectOK();

    const missingOnCreate = await api("POST", "/projects", {
      id: "ghost",
      codePrefix: "GHO",
      name: "Ghost",
      relPath: "does/not/exist",
    });
    expect(missingOnCreate.status).toBe(400);
    expect((await json<ErrorBody>(missingOnCreate)).error.code).toBe("path_not_found");

    const missingOnPatch = await api("PATCH", "/projects/alpha", { relPath: "nope/nowhere" });
    expect(missingOnPatch.status).toBe(400);
    expect((await json<ErrorBody>(missingOnPatch)).error.code).toBe("path_not_found");

    const unchanged = await api("PATCH", "/projects/alpha", { name: "Alpha 2" });
    expect(unchanged.status).toBe(200);
  });

  test("relPath uniqueness ignores case for POST and PATCH", async () => {
    await createProjectOK();

    const conflictingCreate = await api("POST", "/projects", {
      id: "beta",
      codePrefix: "BET",
      name: "Beta",
      relPath: "REPOS/Alpha/",
    });
    expect(conflictingCreate.status).toBe(409);
    expect((await json<ErrorBody>(conflictingCreate)).error.code).toBe("rel_path_taken");

    await createProjectOK({ id: "beta", codePrefix: "BET", name: "Beta", relPath: "repos/beta" });

    const conflictingPatch = await api("PATCH", "/projects/beta", { relPath: "repos/ALPHA" });
    expect(conflictingPatch.status).toBe(409);
    expect((await json<ErrorBody>(conflictingPatch)).error.code).toBe("rel_path_taken");

    // A project may "rename" itself to a different casing of its own path.
    const ownPath = await api("PATCH", "/projects/alpha", { relPath: "REPOS/ALPHA" });
    expect(ownPath.status).toBe(200);
    expect((await json<Project>(ownPath)).relPath).toBe("REPOS/ALPHA");
  });

  test("GET /projects returns a null git field until a refresh fills the cache", async () => {
    await initRepo("repos/alpha");
    await writeWorkspaceFile("repos/alpha/plan.md", "# Plan\n");
    await createProjectOK();

    const before = await json<{ projects: ProjectWithGit[] }>(await api("GET", "/projects"));
    expect(before.projects[0]?.git).toBeNull();

    await api("POST", "/projects/alpha/refresh");

    const after = await json<{ projects: ProjectWithGit[] }>(await api("GET", "/projects"));
    expect(after.projects[0]?.git).toMatchObject({
      repoPath: path.join(workspace, "repos/alpha"),
      branch: "main",
      dirtyFiles: 1,
    });
    expect(after.projects[0]?.git).toEqual(getProjectSnapshot("alpha") ?? null);
  });

  test("PATCH /projects/:id updates mutable fields and returns 404 for unknown ids", async () => {
    await createProjectOK();

    const response = await api("PATCH", "/projects/alpha", {
      codePrefix: "BET",
      name: "Beta",
      active: false,
      planFiles: ["plan.md"],
      agentDocs: ["AGENTS.md"],
    });
    expect(response.status).toBe(200);
    const updated = await json<Project>(response);
    expect(updated.codePrefix).toBe("BET");
    expect(updated.name).toBe("Beta");
    expect(updated.active).toBe(false);
    expect(updated.planFiles).toEqual(["plan.md"]);
    expect(updated.agentDocs).toEqual(["AGENTS.md"]);

    const list = await json<{ projects: ProjectWithGit[] }>(await api("GET", "/projects"));
    expect(list.projects[0]?.name).toBe("Beta");

    const missing = await api("PATCH", "/projects/does-not-exist", { name: "Nope" });
    expect(missing.status).toBe(404);
    expect((await json<ErrorBody>(missing)).error.code).toBe("not_found");

    const unknownField = await api("PATCH", "/projects/alpha", { createdAt: "x" });
    expect(unknownField.status).toBe(400);

    const badPath = await api("PATCH", "/projects/alpha", { planFiles: ["../../etc/passwd"] });
    expect(badPath.status).toBe(400);
  });

  test("PATCH /projects/:id locks codePrefix once tasks exist", async () => {
    await createProjectOK();
    const now = new Date().toISOString();
    db.run(
      "INSERT INTO tasks (project_id, code, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["alpha", "ALP-1", "First task", now, now],
    );

    const locked = await api("PATCH", "/projects/alpha", { codePrefix: "ZZZ" });
    expect(locked.status).toBe(409);
    expect((await json<ErrorBody>(locked)).error.code).toBe("code_prefix_locked");

    const unchanged = await api("PATCH", "/projects/alpha", { codePrefix: "ALP", name: "Alpha 2" });
    expect(unchanged.status).toBe(200);
    expect((await json<Project>(unchanged)).name).toBe("Alpha 2");
  });

  test("POST /projects/:id/refresh returns a snapshot kept in memory", async () => {
    await initRepo("repos/alpha");
    await writeWorkspaceFile("repos/alpha/plan.md", "# Plan\n");
    await createProjectOK();

    const response = await api("POST", "/projects/alpha/refresh");
    expect(response.status).toBe(200);
    const snapshot = await json<{ repoPath: string; branch: string | null; error?: string }>(response);

    expect(snapshot.error).toBeUndefined();
    expect(snapshot.repoPath).toBe(path.join(workspace, "repos/alpha"));
    expect(snapshot.branch).toBe("main");

    const cached = getProjectSnapshot("alpha");
    expect(cached?.branch).toBe("main");
    expect(cached?.dirtyFiles).toBe(1);

    const missing = await api("POST", "/projects/nope/refresh");
    expect(missing.status).toBe(404);
  });

  test("POST /projects/:id/refresh reports a non-repository directory in the snapshot", async () => {
    await mkdir(path.join(workspace, "plain"), { recursive: true });
    await createProjectOK({ relPath: "plain" });

    const response = await api("POST", "/projects/alpha/refresh");
    expect(response.status).toBe(200);
    const snapshot = await json<{ error?: string }>(response);
    expect(snapshot.error).toContain("Not a git repository");
    expect(getProjectSnapshot("alpha")?.error).toBeDefined();
  });

  test("GET plan reports headings, missing files and drift; ack-drift rebases hashes", async () => {
    await initRepo("repos/alpha");
    await writeWorkspaceFile(
      "repos/alpha/plan.md",
      "# Plan\n\n## Faza 1: Start\n\n- zadanie\n\n### Szczegóły\n",
    );
    await createProjectOK({ planFiles: ["plan.md", "docs/PRD.md"] });

    const initial = await json<PlanState>(await api("GET", "/projects/alpha/plan"));
    expect(initial.projectId).toBe("alpha");
    expect(initial.drift).toBe(false);
    expect(initial.files).toHaveLength(2);

    const plan = initial.files[0]!;
    expect(plan.path).toBe("plan.md");
    expect(plan.exists).toBe(true);
    expect(plan.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.storedHash).toBeNull();
    expect(plan.driftStatus).toBe("untracked");
    expect(plan.headings.map((heading) => heading.title)).toEqual([
      "Plan",
      "Faza 1: Start",
      "Szczegóły",
    ]);
    expect(plan.headings.map((heading) => heading.slug)).toEqual([
      "plan",
      "faza-1-start",
      "szczegóły",
    ]);

    const missing = initial.files[1]!;
    expect(missing.exists).toBe(false);
    expect(missing.hash).toBeNull();
    expect(missing.driftStatus).toBe("missing");

    const acked = await json<PlanState>(await api("POST", "/projects/alpha/plan/ack-drift"));
    expect(acked.drift).toBe(false);
    expect(acked.files[0]?.driftStatus).toBe("clean");
    expect(acked.files[0]?.storedHash).toBe(acked.files[0]?.hash);
    expect(acked.files[1]?.driftStatus).toBe("missing");

    const hashesRow = db
      .query("SELECT plan_hashes_json FROM projects WHERE id = ?")
      .get("alpha") as { plan_hashes_json: string };
    expect(JSON.parse(hashesRow.plan_hashes_json)).toEqual({ "plan.md": acked.files[0]?.hash });

    await writeWorkspaceFile("repos/alpha/plan.md", "# Plan\n\n## Faza 2: Zmiana\n");
    const drifted = await json<PlanState>(await api("GET", "/projects/alpha/plan"));
    expect(drifted.drift).toBe(true);
    expect(drifted.files[0]?.driftStatus).toBe("drift");
    expect(drifted.files[0]?.storedHash).toBe(acked.files[0]?.hash);
    expect(drifted.files[0]?.hash).not.toBe(acked.files[0]?.hash);

    const reAcked = await json<PlanState>(await api("POST", "/projects/alpha/plan/ack-drift"));
    expect(reAcked.drift).toBe(false);
    expect(reAcked.files[0]?.storedHash).toBe(drifted.files[0]?.hash);

    const after = await json<PlanState>(await api("GET", "/projects/alpha/plan"));
    expect(after.drift).toBe(false);
    expect(after.files[0]?.driftStatus).toBe("clean");
  });

  test("PATCH planFiles drops hashes of removed plan files", async () => {
    await initRepo("repos/alpha");
    await writeWorkspaceFile("repos/alpha/plan.md", "# Plan\n");
    await writeWorkspaceFile("repos/alpha/specs/PRD.md", "# PRD\n");
    await createProjectOK({ planFiles: ["plan.md", "specs/PRD.md"] });
    await api("POST", "/projects/alpha/plan/ack-drift");

    const patched = await api("PATCH", "/projects/alpha", { planFiles: ["plan.md"] });
    expect(patched.status).toBe(200);
    const project = await json<Project>(patched);
    expect(Object.keys(project.planHashes)).toEqual(["plan.md"]);

    const planState = await json<PlanState>(await api("GET", "/projects/alpha/plan"));
    expect(planState.files).toHaveLength(1);
    expect(planState.files[0]?.driftStatus).toBe("clean");
  });

  test("planDirs override and null reset follow the project, not the config", async () => {
    const created = await createProjectOK();
    expect(created.planDirs).toEqual(DEFAULT_PLAN_DIRS);
    expect(created.planDirsOverride).toBe(false);

    const overridden = await json<Project>(
      await api("PATCH", "/projects/alpha", { planDirs: ["specs", "context/foundation"] }),
    );
    expect(overridden.planDirs).toEqual(["specs", "context/foundation"]);
    expect(overridden.planDirsOverride).toBe(true);

    const listed = await json<{ projects: ProjectWithGit[] }>(await api("GET", "/projects"));
    expect(listed.projects[0]?.planDirs).toEqual(["specs", "context/foundation"]);
    expect(listed.projects[0]?.planDirsOverride).toBe(true);

    const reset = await json<Project>(await api("PATCH", "/projects/alpha", { planDirs: null }));
    expect(reset.planDirs).toEqual(DEFAULT_PLAN_DIRS);
    expect(reset.planDirsOverride).toBe(false);

    const explicitNull = await createProjectOK({
      id: "beta",
      codePrefix: "BET",
      name: "Beta",
      relPath: "repos/beta",
      planDirs: null,
    });
    expect(explicitNull.planDirs).toEqual(DEFAULT_PLAN_DIRS);
    expect(explicitNull.planDirsOverride).toBe(false);

    const bad = await api("PATCH", "/projects/alpha", { planDirs: ["docs/../../secret"] });
    expect(bad.status).toBe(400);
  });

  test("GET plan scans context dirs, reports origin and acks hashes for discovered files", async () => {
    await initRepo("repos/alpha");
    await writeWorkspaceFile("repos/alpha/plan.md", "# Plan\n");
    await writeWorkspaceFile("repos/alpha/context/foundation/prd.md", "# PRD\n\n## Cel\n");
    await writeWorkspaceFile("repos/alpha/context/foundation/shape-notes.md", "# Notatki\n");
    await writeWorkspaceFile("repos/alpha/context/archive/old.md", "# Stary\n");
    await writeWorkspaceFile("repos/alpha/README.md", "# Repo\n");
    await createProjectOK({ planFiles: ["plan.md"] });

    const initial = await json<PlanState>(await api("GET", "/projects/alpha/plan"));
    expect(initial.truncated).toBe(false);
    expect(initial.files.map((file) => [file.path, file.origin])).toEqual([
      ["plan.md", "file"],
      ["context/foundation/prd.md", "dir"],
      ["context/foundation/shape-notes.md", "dir"],
    ]);
    expect(initial.files.every((file) => file.driftStatus === "untracked")).toBe(true);

    const acked = await json<PlanState>(await api("POST", "/projects/alpha/plan/ack-drift"));
    expect(acked.drift).toBe(false);
    const prd = acked.files.find((file) => file.path === "context/foundation/prd.md");
    expect(prd?.driftStatus).toBe("clean");
    expect(prd?.storedHash).toBe(prd?.hash);

    const hashesRow = db
      .query("SELECT plan_hashes_json FROM projects WHERE id = ?")
      .get("alpha") as { plan_hashes_json: string };
    const hashes = JSON.parse(hashesRow.plan_hashes_json) as Record<string, string>;
    expect(hashes["context/foundation/prd.md"] ?? "").toBe(prd?.hash ?? "");

    await writeWorkspaceFile("repos/alpha/context/foundation/prd.md", "# PRD\n\n## Nowy cel\n");
    const drifted = await json<PlanState>(await api("GET", "/projects/alpha/plan"));
    expect(drifted.drift).toBe(true);
    expect(drifted.files.find((file) => file.path === "context/foundation/prd.md")?.driftStatus).toBe(
      "drift",
    );

    const reAcked = await json<PlanState>(await api("POST", "/projects/alpha/plan/ack-drift"));
    expect(reAcked.drift).toBe(false);
  });

  test("PATCH planDirs drops hashes of files that are no longer resolved", async () => {
    await initRepo("repos/alpha");
    await writeWorkspaceFile("repos/alpha/context/prd.md", "# PRD\n");
    await writeWorkspaceFile("repos/alpha/specs/plan.md", "# Specs\n");
    await createProjectOK({ planFiles: [] });
    await api("POST", "/projects/alpha/plan/ack-drift");

    const before = db
      .query("SELECT plan_hashes_json FROM projects WHERE id = ?")
      .get("alpha") as { plan_hashes_json: string };
    expect(Object.keys(JSON.parse(before.plan_hashes_json) as Record<string, string>)).toEqual([
      "context/prd.md",
    ]);

    const patched = await json<Project>(
      await api("PATCH", "/projects/alpha", { planDirs: ["specs"] }),
    );
    expect(patched.planHashes).toEqual({});

    const plan = await json<PlanState>(await api("GET", "/projects/alpha/plan"));
    expect(plan.files.map((file) => file.path)).toEqual(["specs/plan.md"]);
  });

  test("GET plan reports truncated when the directory scan hits 200 files", async () => {
    await initRepo("repos/alpha");
    for (let index = 0; index < 201; index += 1) {
      await writeWorkspaceFile(
        `repos/alpha/context/batch/${String(index).padStart(3, "0")}.md`,
        `# Plik ${index}\n`,
      );
    }
    await createProjectOK({ planFiles: [] });

    const plan = await json<PlanState>(await api("GET", "/projects/alpha/plan"));
    expect(plan.files).toHaveLength(200);
    expect(plan.truncated).toBe(true);
  });

  test("GET docs returns agent doc content and flags absent files", async () => {
    await initRepo("repos/alpha");
    await writeWorkspaceFile("repos/alpha/AGENTS.md", "# AGENTS\n\nZgłaszaj wątpliwości.\n");
    await createProjectOK({ agentDocs: ["AGENTS.md", "CLAUDE.md"] });

    const response = await api("GET", "/projects/alpha/docs");
    expect(response.status).toBe(200);
    const docs = await json<DocsBody>(response);
    expect(docs.projectId).toBe("alpha");
    expect(docs.files).toHaveLength(2);
    expect(docs.files[0]).toMatchObject({ path: "AGENTS.md", exists: true });
    expect(docs.files[0]?.content).toContain("Zgłaszaj wątpliwości.");
    expect(docs.files[1]).toMatchObject({ path: "CLAUDE.md", exists: false, content: null });
  });

  test("POST /discovery/scan finds repositories, stops at repo boundaries and never auto-registers", async () => {
    await initRepo("repo-a");
    await initRepo("team/repo-b");
    await initRepo("repo-a/nested");
    await initRepo("deep/one/two");
    await mkdir(path.join(workspace, "not-a-repo"), { recursive: true });

    const scan = await json<{ repos: DiscoveredRepo[] }>(await api("POST", "/discovery/scan"));
    expect(scan.repos.map((repo) => repo.relPath)).toEqual(["repo-a", "team/repo-b"]);
    expect(scan.repos[0]).toMatchObject({ name: "repo-a", alreadyRegistered: false });
    expect(scan.repos[1]).toMatchObject({ name: "repo-b", alreadyRegistered: false });

    const countRow = db.query("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    expect(countRow.count).toBe(0);

    await createProjectOK({ id: "repo-a", codePrefix: "RPA", name: "Repo A", relPath: "repo-a" });

    const second = await json<{ repos: DiscoveredRepo[] }>(await api("POST", "/discovery/scan"));
    expect(second.repos.find((repo) => repo.relPath === "repo-a")?.alreadyRegistered).toBe(true);
    expect(second.repos.find((repo) => repo.relPath === "team/repo-b")?.alreadyRegistered).toBe(
      false,
    );
  });
});
