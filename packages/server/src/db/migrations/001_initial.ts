export const INITIAL_SQL = `
CREATE TABLE projects (
  id                TEXT PRIMARY KEY,
  code_prefix       TEXT NOT NULL,
  name              TEXT NOT NULL,
  rel_path          TEXT NOT NULL UNIQUE,
  plan_files_json   TEXT NOT NULL DEFAULT '[]',
  agent_docs_json   TEXT NOT NULL DEFAULT '[]',
  plan_hashes_json  TEXT NOT NULL DEFAULT '{}',
  next_task_seq     INTEGER NOT NULL DEFAULT 1,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);

CREATE TABLE tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  plan_file         TEXT,
  plan_section      TEXT,
  status            TEXT NOT NULL DEFAULT 'backlog',
  priority          TEXT NOT NULL DEFAULT 'medium',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  claimed_by        TEXT,
  git_branch        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  completed_at      TEXT
);

CREATE TABLE comments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_type       TEXT NOT NULL,
  author_name       TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'comment',
  body              TEXT NOT NULL,
  is_resolved       INTEGER NOT NULL DEFAULT 0,
  resolved_at       TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE attachments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  comment_id        INTEGER REFERENCES comments(id) ON DELETE SET NULL,
  filename          TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  storage_path      TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE task_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id           INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,
  old_value         TEXT,
  new_value         TEXT,
  actor             TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_comments_task_doubt ON comments(task_id, kind, is_resolved);
CREATE INDEX idx_events_project_date ON task_events(project_id, created_at);
`;