import type { Database } from "bun:sqlite";
import { INITIAL_SQL } from "./migrations/001_initial";
import { REL_PATH_CI_UNIQUE_SQL } from "./migrations/002_rel_path_ci_unique";
import { PROJECT_PLAN_DIRS_SQL } from "./migrations/003_project_plan_dirs";

interface Migration {
  version: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  { version: "001_initial", up: INITIAL_SQL },
  { version: "002_rel_path_ci_unique", up: REL_PATH_CI_UNIQUE_SQL },
  { version: "003_project_plan_dirs", up: PROJECT_PLAN_DIRS_SQL },
];

export function runMigrations(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.query("SELECT version FROM schema_migrations").all() as { version: string }[]).map(
      (row) => row.version,
    ),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.run(migration.up);
      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
        migration.version,
        new Date().toISOString(),
      ]);
    })();
  }
}