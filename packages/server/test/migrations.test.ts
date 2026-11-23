import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, runMigrations } from "../src/db";

describe("migrations", () => {
  test("creates all tables and enables foreign_keys", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const dbPath = path.join(dir, "board.db");
    const db = openDatabase(dbPath);
    runMigrations(db);

    const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
      .map((r) => r.name)
      .sort();
    expect(tables).toContain("projects");
    expect(tables).toContain("tasks");
    expect(tables).toContain("comments");
    expect(tables).toContain("attachments");
    expect(tables).toContain("task_events");
    expect(tables).toContain("schema_migrations");

    const fk = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);

    const jm = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(jm.journal_mode).toBe("wal");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("records applied migration", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const dbPath = path.join(dir, "board.db");
    const db = openDatabase(dbPath);
    runMigrations(db);
    const rows = db.query("SELECT version FROM schema_migrations").all() as { version: string }[];
    expect(rows.map((r) => r.version)).toContain("001_initial");
    expect(rows.map((r) => r.version)).toContain("002_rel_path_ci_unique");
    expect(rows.map((r) => r.version)).toContain("003_project_plan_dirs");
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("adds a nullable plan_dirs_json column so existing rows use config defaults", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const dbPath = path.join(dir, "board.db");
    const db = openDatabase(dbPath);
    runMigrations(db);

    const columns = db.query("PRAGMA table_info(projects)").all() as {
      name: string;
      notnull: number;
    }[];
    const planDirs = columns.find((column) => column.name === "plan_dirs_json");
    expect(planDirs).toBeDefined();
    expect(planDirs?.notnull).toBe(0);

    db.run(
      `INSERT INTO projects (id, code_prefix, name, rel_path, created_at)
       VALUES ('legacy', 'LEG', 'Legacy', 'legacy', ?)`,
      [new Date().toISOString()],
    );
    const row = db.query("SELECT plan_dirs_json FROM projects WHERE id = 'legacy'").get() as {
      plan_dirs_json: string | null;
    };
    expect(row.plan_dirs_json).toBeNull();

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("enforces case-insensitive rel_path uniqueness through the 002 index", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const dbPath = path.join(dir, "board.db");
    const db = openDatabase(dbPath);
    runMigrations(db);

    const index = db
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("idx_projects_rel_path_lower") as { name: string } | null;
    expect(index?.name).toBe("idx_projects_rel_path_lower");

    const insert = (id: string, relPath: string) =>
      db.run(
        `INSERT INTO projects (id, code_prefix, name, rel_path, created_at)
         VALUES (?, 'PRJ', 'Project', ?, ?)`,
        [id, relPath, new Date().toISOString()],
      );

    insert("one", "Repos/Alpha");
    expect(() => insert("two", "repos/alpha")).toThrow();
    expect(() => insert("three", "REPOS/ALPHA")).toThrow();
    insert("four", "repos/beta");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("foreign key constraint is enforced", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const dbPath = path.join(dir, "board.db");
    const db = openDatabase(dbPath);
    runMigrations(db);
    expect(() => {
      db.run("INSERT INTO tasks (project_id, code, title, created_at, updated_at) VALUES ('nope', 'X-1', 't', 'a', 'b')");
    }).toThrow();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});