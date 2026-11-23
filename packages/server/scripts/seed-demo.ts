/**
 * Tworzy dane demonstracyjne: trzy repozytoria w katalogu demo-workspace
 * oraz projekty, zadania, komentarze i zdarzenia w bazie.
 *
 * Uruchomienie z katalogu agent-board:
 *   bun packages/server/scripts/seed-demo.ts
 *
 * Skrypt jest idempotentny: przy istniejących projektach kończy pracę bez zmian.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "../src/db/migrations";

const ROOT = process.cwd();
const WORKSPACE = path.join(ROOT, "demo-workspace");
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "board.db");

const now = new Date().toISOString();
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function gitRepo(
  relPath: string,
  planContent: string,
  agentsContent: string,
  commit: string,
  extraFiles: Record<string, string> = {},
) {
  const dir = path.join(WORKSPACE, relPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "plan.md"), planContent);
  writeFileSync(path.join(dir, "AGENTS.md"), agentsContent);
  for (const [relativePath, content] of Object.entries(extraFiles)) {
    const target = path.join(dir, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  const run = (args: string[]) => {
    const proc = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
    }
  };

  if (!existsSync(path.join(dir, ".git"))) {
    run(["init", "-q"]);
    run(["symbolic-ref", "HEAD", "refs/heads/main"]);
    run(["config", "user.name", "Agent Board Demo"]);
    run(["config", "user.email", "demo@agent-board.local"]);
    run(["config", "commit.gpgsign", "false"]);
    run(["add", "."]);
    run(["commit", "-q", "-m", commit]);
  }
  return dir;
}

const workflowPlan = `# Workflow Core — plan

## 1. Silnik stanów i wersjonowanie
Niezmienne wersje definicji procesów oraz migracja aktywnych instancji.

## 2. Polityka ponowień i eskalacja HITL
Maksymalnie 3 próby agenta, następnie przekazanie zadania do człowieka.

## 3. Modularne skille (JSON + Markdown)
Kontrakt wejścia/wyjścia dla kroków agentowych bez ciężkich zależności.
`;

const mobilePlan = `# Mobile Client — plan

## 1. Warstwa sieciowa i autoryzacja
Odświeżanie tokenów w tle i bezpieczny Keychain.

## 2. Synchronizacja offline
Kolejka mutacji i rozwiązywanie prostych konfliktów.
`;

const transitPlan = `# Transit Monitor — plan

## 1. Parser GTFS-RT i filtr floty
Odczyt feedów binarnych protobuf i mapowanie pojazdów.

## 2. Dashboard one-pager
Lekki widok dark-mode bez bazy danych.
`;

const workflowPrd = `# Workflow Core — PRD

## Cel
Silnik procesów agentowych z bezpiecznym przekazywaniem zadań do człowieka.

## Wymagania
- Wersjonowanie definicji procesu bez przerywania aktywnych instancji.
- Limit trzech prób dla kroku agentowego.
- Czytelny dziennik zdarzeń dla każdej instancji.
`;

const workflowShapeNotes = `# Workflow Core — notatki z kształtowania

## Persona
Zespół platformowy utrzymujący procesy agentowe.

## Zakres MVP
- Definicje procesów w JSON.
- Eskalacja HITL po wyczerpaniu prób.
- Panel ze stanem instancji.

## Poza zakresem
- Wizualny edytor procesów.
- Współdzielenie definicji między organizacjami.
`;

gitRepo(
  "workflow-core",
  workflowPlan,
  "# AGENTS.md — Workflow Core\n\n- Każda zmiana w silniku wymaga testu integracyjnego.\n",
  "[WFC-12] Immutable process snapshot schema",
  {
    "context/foundation/prd.md": workflowPrd,
    "context/foundation/shape-notes.md": workflowShapeNotes,
  },
);
gitRepo(
  "mobile-swift",
  mobilePlan,
  "# AGENTS.md — Mobile Client\n\n- Używaj Swift Concurrency.\n",
  "[MOB-07] Local cache invalidation hook",
);
gitRepo(
  "transit-watch",
  transitPlan,
  "# AGENTS.md — Transit Monitor\n\n- Zero bazy danych: zapis atomowy do data/stats.json.\n",
  "[TRW-05] Flat-file atomic stats writer",
);

mkdirSync(DATA_DIR, { recursive: true });
const configFile = path.join(DATA_DIR, "config.yaml");
if (!existsSync(configFile)) {
  writeFileSync(configFile, "port: 4321\ngit_poll_interval_sec: 300\n");
}

// Jedno źródło workspace: `.env` w katalogu głównym (Bun i docker compose czytają ten plik).
const envFile = path.join(ROOT, ".env");
if (!existsSync(envFile)) {
  writeFileSync(envFile, `WORKSPACE_PATH=${WORKSPACE}\n`);
  console.log(`Utworzono ${envFile} z WORKSPACE_PATH=${WORKSPACE}`);
} else {
  const current = readFileSync(envFile, "utf8");
  const match = current.match(/^WORKSPACE_PATH=(.*)$/m);
  const configured = match?.[1]?.trim();
  if (configured !== WORKSPACE) {
    console.warn(
      `Uwaga: ${envFile} wskazuje WORKSPACE_PATH=${configured ?? "(brak)"}, a demo leży w ${WORKSPACE}.\n` +
        "Portal użyje wartości z .env — zmień ją, jeśli chcesz oglądać dane demo.",
    );
  }
}
const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA foreign_keys = ON;");
runMigrations(db);

const existing = db.query("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
if (existing.n > 0) {
  console.log(`Baza ${DB_PATH} ma już ${existing.n} projekt(y) — pomijam seed.`);
  process.exit(0);
}

const projects = [
  {
    id: "workflow-core",
    prefix: "WFC",
    name: "Workflow Core",
    relPath: "workflow-core",
    planFiles: ["plan.md"],
    agentDocs: ["AGENTS.md"],
  },
  {
    id: "mobile-swift",
    prefix: "MOB",
    name: "Mobile Client (Swift)",
    relPath: "mobile-swift",
    planFiles: ["plan.md"],
    agentDocs: ["AGENTS.md"],
  },
  {
    id: "transit-watch",
    prefix: "TRW",
    name: "Transit Monitor",
    relPath: "transit-watch",
    planFiles: ["plan.md"],
    agentDocs: ["AGENTS.md"],
  },
];

const insertProject = db.prepare(
  `INSERT INTO projects (id, code_prefix, name, rel_path, plan_files_json, agent_docs_json, plan_hashes_json, next_task_seq, active, created_at)
   VALUES (?, ?, ?, ?, ?, ?, '{}', ?, 1, ?)`,
);

for (const p of projects) {
  insertProject.run(
    p.id,
    p.prefix,
    p.name,
    p.relPath,
    JSON.stringify(p.planFiles),
    JSON.stringify(p.agentDocs),
    1,
    now,
  );
}

const insertTask = db.prepare(
  `INSERT INTO tasks (project_id, code, title, description, plan_file, plan_section, status, priority, sort_order, claimed_by, git_branch, created_at, updated_at, completed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const tasks: Array<[string, string, string, string, string, string, string, string, string | null, string | null, string | null]> = [
  [
    "workflow-core", "WFC-14", "Polityka retry (3 próby) i eskalacja do HITL",
    "Po 3 nieudanych wywołaniach węzła agentowego silnik ma wstrzymać proces ze statusem awaiting_human.",
    "plan.md", "2. Polityka ponowień i eskalacja HITL", "needs_input", "urgent", "opencode", "feat/retry-policy", null,
  ],
  [
    "workflow-core", "WFC-15", "Walidacja kontraktu skilli JSON/Markdown przy starcie",
    "Walidator sprawdzający wymagane pola input_schema i output_fields podczas ładowania katalogu skilli.",
    "plan.md", "3. Modularne skille (JSON + Markdown)", "ready", "high", null, null, null,
  ],
  [
    "workflow-core", "WFC-12", "Niezmienne wersjonowanie definicji procesu",
    "Każdy zapis definicji tworzy nową wersję vN, a bieżące instancje dokańczają bieg na swojej wersji.",
    "plan.md", "1. Silnik stanów i wersjonowanie", "done", "high", "t3code", "main", iso(18),
  ],
  [
    "mobile-swift", "MOB-08", "Kolejka mutacji offline z ponawianiem po odzyskaniu sieci",
    "Zapis oczekujących operacji w lokalnym magazynie i automatyczna synchronizacja przez NWPathMonitor.",
    "plan.md", "2. Synchronizacja offline", "in_progress", "high", "opencode", "feat/offline-sync", null,
  ],
  [
    "mobile-swift", "MOB-07", "Hook czyszczenia lokalnego cache po wylogowaniu",
    "Wyczyszczenie pamięci podręcznej i tokenów Keychain.",
    "plan.md", "1. Warstwa sieciowa i autoryzacja", "done", "medium", "opencode", "main", iso(120),
  ],
  [
    "transit-watch", "TRW-06", "Oznaczenie kursów technicznych na widoku tabeli",
    "Dodanie subtelnego badge Techniczny dla pojazdów bez przypisanej linii komercyjnej.",
    "plan.md", "2. Dashboard one-pager", "backlog", "low", null, null, null,
  ],
  [
    "transit-watch", "TRW-05", "Atomowy zapis statystyk zjazdów do pliku płaskiego",
    "Zapis do pliku tymczasowego + rename w celu uniknięcia uszkodzenia JSON.",
    "plan.md", "2. Dashboard one-pager", "done", "high", "t3code", "main", iso(1440),
  ],
];

const codeToId = new Map<string, number>();
tasks.forEach(([projectId, code, title, description, planFile, planSection, status, priority, claimedBy, gitBranch, completedAt], index) => {
  insertTask.run(
    projectId, code, title, description, planFile, planSection, status, priority, index, claimedBy, gitBranch,
    now, now, completedAt,
  );
  const row = db.query("SELECT id FROM tasks WHERE code = ?").get(code) as { id: number };
  codeToId.set(code, row.id);
});

const insertComment = db.prepare(
  `INSERT INTO comments (task_id, author_type, author_name, kind, body, is_resolved, resolved_at, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insertEvent = db.prepare(
  `INSERT INTO task_events (project_id, task_id, event_type, old_value, new_value, actor, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

insertComment.run(
  codeToId.get("WFC-14")!, "agent", "opencode", "progress",
  "Dodałem licznik prób w StepExecution oraz konfigurację limitu (domyślnie 3). Testy jednostkowe przechodzą.",
  0, null, iso(32),
);
insertComment.run(
  codeToId.get("WFC-14")!, "agent", "opencode", "doubt",
  "Czy błąd walidacji schematu JSON z LLM powinien zużywać tę samą pulę 3 prób co timeout HTTP, czy mieć osobny licznik?",
  0, null, iso(14),
);
insertComment.run(
  codeToId.get("WFC-15")!, "human", "Ty", "comment",
  "Błędy walidacji mają wskazywać dokładną ścieżkę pliku skilla i brakujący klucz.",
  0, null, iso(60),
);
insertComment.run(
  codeToId.get("MOB-08")!, "agent", "opencode", "doubt",
  "Przy konflikcie edycji (409) wybieramy last-write-wins czy pokazujemy baner z wyborem wersji?",
  0, null, iso(48),
);
insertComment.run(
  codeToId.get("WFC-12")!, "agent", "t3code", "progress",
  "Zaimplementowano snapshotowanie definicji przy starcie instancji. Wszystkie testy zielone.",
  0, null, iso(19),
);

insertEvent.run("workflow-core", codeToId.get("WFC-14")!, "doubt_opened", "in_progress", "needs_input", "opencode", iso(14));
insertEvent.run("workflow-core", codeToId.get("WFC-12")!, "completed", "in_progress", "done", "t3code", iso(18));
insertEvent.run("mobile-swift", codeToId.get("MOB-08")!, "doubt_opened", "in_progress", "needs_input", "opencode", iso(48));
insertEvent.run("mobile-swift", codeToId.get("MOB-07")!, "completed", "in_progress", "done", "opencode", iso(120));
insertEvent.run("transit-watch", codeToId.get("TRW-05")!, "completed", "in_progress", "done", "t3code", iso(1440));

// Kolejne zadania powinny startować za najwyższym istniejącym numerem.
const advanceSeq = db.prepare(
  `UPDATE projects
      SET next_task_seq = (
        SELECT COALESCE(MAX(CAST(SUBSTR(code, LENGTH(?) + 2) AS INTEGER)), 0) + 1
          FROM tasks
         WHERE project_id = ?
      )
    WHERE id = ?`,
);
for (const p of projects) {
  advanceSeq.run(p.prefix, p.id, p.id);
}

console.log(`Gotowe. Workspace: ${WORKSPACE}`);console.log(`Baza: ${DB_PATH}`);
console.log(`Projekty: ${projects.length}, zadania: ${tasks.length}`);
console.log(`Uruchom: bun run build:web && bun run dev`);
