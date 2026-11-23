# V3rne — AI usage reference

For AI agents consuming this service. Humans: README.md. Working on this repo: plan.md.

## Meta
Service V3rne (repo `agent-board`; local Mission Control for AI-assisted repos). Runtime bun 1.4 + TS strict; Hono; SQLite `bun:sqlite` (WAL, FK on); React+Vite UI served by Hono.
Endpoints: REST `/api/v1`; MCP `/mcp` (Streamable HTTP, **stateless**, POST only). Default bind `127.0.0.1:4321`; no auth (local only).
State: `DATA_DIR` (default `<repo>/data`): `board.db`, `config.yaml`, `uploads/`.
Repos are mounted **read-only**; every git call runs `git --no-optional-locks`. The service never writes to monitored repos.
! = throws/returns error. Task code format `PREFIX-N` (`[A-Z]+-\d+`), e.g. `WFC-14`.

## Connect (MCP)
```json
{ "mcp": { "agent-board": { "type": "remote", "url": "http://127.0.0.1:4321/mcp", "enabled": true } } }
```
Raw HTTP: `POST /mcp`, `Content-Type: application/json`, `Accept: application/json, text/event-stream`.
`GET /mcp` -> 405 (no SSE stream). `DELETE /mcp` -> 204. Each POST builds a fresh server; state lives in SQLite.
Tool errors: `{ "isError": true, "content": [{ "type": "text", "text": "<code>: <message>" }] }`. Success: `content[0].text` is JSON (except `get_attachment`).

## MCP tools
`list_projects(only_active?: boolean = true)`
  -> `{projects:[{id,codePrefix,name,relPath,active,planFiles,openTasks:{ready,in_progress,needs_input,total}}]}`
  `total` = backlog+ready+in_progress+needs_input.

`get_project_context(project_id?: string, cwd?: string)` — resolves by id or by `cwd` (longest `workspace_root+relPath` prefix wins).
  -> `{project:{...summary,agentDocs:string[]}, plan:{available,repoPath,files:[{path,origin,exists,hash,storedHash,driftStatus,headings:[{level,title,slug,line}]}],truncated,error?}, worktrees:[{path,branch}], git:{snapshotAvailable,...}|{snapshotAvailable:false}, board:{statuses,total}}`
  `origin` = `file|dir` (explicit `planFiles` vs a file found in `planDirs`). `truncated` = the directory scan hit its 200-file limit.
  `driftStatus` = `clean|untracked|drift|missing|error`. Git fields come from the in-memory snapshot; without a poller/refresh run only `snapshotAvailable:false` is returned.

`list_tasks(project_id: string, status?: Status, priority?: Priority)`
  -> `{projectId,tasks:[Task & {openComments,openDoubts}]}`, sort `priority DESC (urgent>high>medium>low), sort_order ASC, id ASC`.

`get_next_task(project_id?: string, cwd?: string, claim?: boolean, agent_name?: string)`
  -> `{task: Task+comments+attachments | null, claimed: boolean, reused?: boolean, message?: string}`
  With `claim` + `agent_name`: idempotent — if that agent already has an `in_progress` task (in scope, active project) it is returned with `reused:true`. Otherwise the top `ready` task is claimed atomically (`BEGIN IMMEDIATE`), status -> `in_progress`, event `claimed`. Without `project_id`/`cwd` it searches **all active projects**. `claim=true` without `agent_name` sets `claimed_by="agent"` (no idempotency). Only `ready` is claimable (`backlog` is not).

`create_tasks(project_id: string, tasks: [{title, description?="", plan_file?, plan_section?, priority?="medium", status?="backlog"|"ready"}] )` — 1..100 items, one transaction. Duplicate titles (trim, case-insensitive, whole project regardless of plan section, also vs existing tasks) reject the **whole** batch: `isError` listing titles. -> `{projectId,codes,tasks}`.

`update_task(task_code, status?, priority?, git_branch?, claimed_by?)` — writes `task_events` (`status_changed`/`completed`, `priority_changed`, `branch_changed`, `claimed*`). `done` sets `completed_at`; other statuses clear it. No transition restrictions (manual moves allowed).

`add_entry(task_code, kind: "comment"|"doubt"|"progress"|"decision", body, author_name?="agent")` — `author_type="agent"`. `doubt` sets task `needs_input` (unless `done`/`cancelled`), event `doubt_opened`. Others add event `entry_added`.

`get_attachment(attachment_id)` — `image/*` -> MCP `image` block (base64) + text metadata; `text/*`, `.log`, json/markdown -> `text`; other MIME or size > `mcp_attachment_max_bytes` (default 5 MiB) -> `isError`.

`get_task(task_code)` — one task with full context: `{task: Task+comments+attachments+events, projectId, projectName}`. `events` = last 50 `task_events`, oldest first. Bad code format -> `isError` (MCP input validation, `-32602`); unknown code -> `isError` `task_not_found`.

`list_doubts(project_id?: string, only_open?: boolean = true)` -> `{doubts:[{comment, task:{code,title,priority,status,projectId,projectName}}]}`. Sorted priority (urgent>high>medium>low), then `comment.createdAt` ASC. Without `project_id`: active projects only. With `project_id`: works even if the project is inactive; unknown id -> `project_not_found`. `only_open=false` includes resolved doubts.

Resolve a doubt from an agent: `add_entry(kind="decision", body=<answer>)`, then `update_task(status="ready")` — or let the human resolve it in the UI. Find open doubts first with `list_doubts`.

## REST (`/api/v1`)
Projects
`GET /projects` -> `{projects:[Project & {git: GitSnapshot|null}]}` (snapshot cached; `null` before first poll/refresh).
`POST /projects` `{id,codePrefix,name,relPath,planFiles?,planDirs?,agentDocs?,active?}` -> 201 `Project`; 409 `id_taken|rel_path_taken`; 400 `path_not_found` when `relPath` is not an existing directory under `workspace_root` (checked only when the workspace is configured).
`PATCH /projects/:id` `{name?,active?,planFiles?,planDirs?,agentDocs?,codePrefix?,relPath?}` -> `Project`; 409 `code_prefix_locked` (tasks exist); `relPath` change clears cached snapshot.
`Project.planDirs` is the effective list and `planDirsOverride` tells whether it comes from the row (true) or `defaults.plan_dirs` (false). `planDirs: null` on POST/PATCH stores NULL, i.e. falls back to the config default.
`POST /projects/:id/refresh` -> `GitSnapshot` (200 even when `snapshot.error`).
`GET /projects/:id/plan` -> `{projectId,files:[{path,origin,exists,hash,storedHash,driftStatus,headings,error?}],drift,truncated}`.
`POST /projects/:id/plan/ack-drift` -> `{projectId,files,drift:false,truncated}` (writes current hashes for every resolved file, prunes removed ones).
`GET /projects/:id/docs` -> `{projectId,files:[{path,exists,content,error?}]}` (agent docs only, reads `agentDocs` as before).
`POST /discovery/scan` -> `{repos:[{relPath,name,alreadyRegistered}]}` (never registers).

Tasks
`GET /projects/:id/tasks?status=&priority=&planSection=` -> `{tasks:[Task]}`.
`POST /projects/:id/tasks` `{title,description?,priority?="medium",status?="backlog"|"ready",planFile?,planSection?,actor?="human"}` -> 201 `Task`; code from `next_task_seq` in-transaction. Single create returns 409 `duplicate_title` on the same rule.
`POST /projects/:id/tasks/bulk` `{tasks:[...]}` (1..100) -> 201 `{tasks}`; 409 `duplicate_title` with `index`.
`GET /tasks/:code` -> `Task + {comments,attachments,events}`.
`PATCH /tasks/:code` `{status?,priority?,sortOrder?,planFile?,planSection?,title?,description?,claimedBy?,gitBranch?,actor?}` -> `Task`. Only status/priority/claim/branch produce events.
`DELETE /tasks/:code` -> 204 (cascade DB rows + attachment files on disk).

Comments / doubts / stats
`POST /tasks/:code/comments` `{authorType:"human"|"agent",authorName,kind,body}` -> 201 `Comment`; `kind=doubt` -> task `needs_input`, event `doubt_opened`.
`POST /comments/:id/resolve` `{reply,authorType?="human",authorName?="Ty"}` -> `{comment,doubt,task,statusChanged,openDoubts}`; 409 `not_a_doubt|already_resolved`; last open doubt on `needs_input` -> `ready`.
`GET /doubts` -> `{doubts:[{comment,task:{code,title,priority,projectId,projectName}}]}` sorted priority, then `createdAt`.
`GET /stats` -> `{generatedAt,velocity:[{week:"2026-W47",count}×8],doubts:{averageMinutes,resolvedCount,openCount},statusByProject:[{projectId,projectName,statuses,total}],recentEvents[20]}`.

Attachments
`POST /tasks/:code/attachments` multipart field `file` (+ optional `commentId`) -> 201 `Attachment`; 413 `file_too_large` at `max_attachment_bytes` (default 10 MiB, **per file**); any extension accepted; stored `DATA_DIR/uploads/<projectId>/<taskCode>/<uuid>-<sanitizedName>`.
`GET /attachments/:id/raw` -> bytes, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` (never inline).
`DELETE /attachments/:id` -> 204.

Errors: `{error:{code,message}}`, HTTP 400/404/409/413/500. Collections always objects with a key.

## Model
`Status` = `backlog|ready|in_progress|needs_input|done|cancelled`. `Priority` = `low|medium|high|urgent`.
`CommentKind` = `comment|doubt|progress|decision`. `AuthorType` = `human|agent`.
Automation: `doubt` -> `needs_input`; last doubt resolved -> `ready`; `done` -> `completed_at`+event `completed`.

## Config (`DATA_DIR/config.yaml`, optional; Zod-validated)
Workspace has one source: `WORKSPACE_PATH` in `.env` (read by Bun and docker compose). `workspace_root` in `config.yaml` is a legacy fallback and is ignored when the env var is set.
```yaml
port: 4321
host: 127.0.0.1
git_poll_interval_sec: 300
max_attachment_bytes: 10485760       # REST upload, per file
mcp_attachment_max_bytes: 5242880    # MCP get_attachment
defaults:
  scan_depth: 2
  plan_files: ["plan.md", "PLAN.md", "docs/plan.md", "docs/PRD.md"]
  plan_dirs: ["context", "docs"]          # skanowane rekurencyjnie (głębokość 3) po *.md
  plan_dir_exclude: ["archive", "node_modules", ".git"]  # nazwy katalogów pomijane na każdym poziomie
  agent_docs: ["AGENTS.md", "CLAUDE.md", "README_AI.md", ".cursorrules"]
```
Projects are **not** in config.yaml; they live in SQLite (UI configurator or `POST /projects`).
`plan_dirs` / `plan_dir_exclude` must be relative paths / plain directory names (no `..`, no absolute paths).

## Gotchas
- `get_next_task` claim is idempotent **only** with `agent_name`; reuse is limited to active projects (and to `project_id` when given).
- `get_task` returns at most the last 50 events; the REST `GET /tasks/:code` returns all of them.
- Claim is a 3-attempt CAS loop; concurrent claim of the same row is retried, never double-assigned.
- `backlog` is not claimable; move it to `ready` first (`update_task`).
- `plan.md`/`PLAN.md` are read once (case-insensitive filesystems); `storedHash` is keyed by the path string used in `ack-drift`.
- Plan sources = explicit `planFiles` (always, even when missing) + all `*.md` under `plan_dirs` (recursive, depth 3). `plan_dir_exclude` names are skipped at every level, so `context/archive/*.md` is invisible; files outside the dirs (e.g. root `README.md`) are not plan files. Directory symlinks are not followed. The scan stops at 200 files and then `truncated=true`.
- `ack-drift` writes hashes for every resolved file, not only `planFiles`, so drift of a `plan_dirs` file clears normally. Changing `planFiles`/`planDirs` prunes hashes of files that are no longer resolved.
- Drift compares SHA-256 of LF-normalized content; no stored hash = `untracked`, missing file = `missing` (never `drift`).
- `WORKSPACE_PATH` (env/.env) wins over `config.yaml: workspace_root`; both are accepted, but use only the env var.
- `relPath` is normalized (trim, `/`, no trailing slash) and unique case-insensitively; the stored value keeps its original case.
- Git snapshots are in memory only; the poller refreshes active projects at startup and every interval. `ahead/behind` uses the last local `git fetch` — the service never fetches.
- Snapshot fields: `branch,dirtyFiles,worktrees,branches,changedFiles(+changedFilesTruncated, cap 500),recentlyTouchedFiles(+recentlyTouchedFilesTruncated, cap 200),commits(40),lastCommit,ahead,behind,error?,stale?,lastErrorAt?,lastError?`. File contents are not read except plan/docs files.
- A failed poll keeps the previous snapshot and sets `stale:true` + `lastErrorAt`/`lastError`; `error` is set only when no good snapshot was ever read.
- Commit->task linking is regex `\[([A-Z]+-\d+)\]` in the subject.
- Duplicate titles are rejected across the whole project (trim, case-insensitive, any plan section) in `create_tasks`, `tasks/bulk` and single `POST` alike.
- `DELETE /tasks/:code` removes attachment files too; unlink errors are logged, still 204.
- No auth: keep the service on loopback. Do not expose `/mcp` or `/api/v1` publicly.
- UI previews `image/png|jpeg|gif|webp` inline; SVG is download-only (XSS).

## Tasks (intent -> call)
start work: `get_next_task(cwd="$PWD", claim=true, agent_name="<me>")` -> read `task.comments`, `task.attachments`
see plan and board: `get_project_context(cwd="$PWD")`
read one task with history: `get_task(task_code)`
find open questions: `list_doubts()` (all active projects) or `list_doubts(project_id)`
pick highest priority ready: `get_next_task(cwd="$PWD")` (claim=false, no mutation)
report progress: `add_entry(task_code, kind="progress", body="...")`
ask a human: `add_entry(task_code, kind="doubt", body="...")` -> task becomes `needs_input`; stop work
answer with a decision: `add_entry(task_code, kind="decision", body="...")` + `update_task(task_code, status="ready")`
break a plan section into tasks: `get_project_context` -> headings -> `create_tasks(project_id, tasks[], plan_section=<heading.title>)`
attach a screenshot: `POST /api/v1/tasks/<code>/attachments` (multipart `file`)
read an attachment: `get_attachment(attachment_id)` (images) or `GET /api/v1/attachments/<id>/raw`
finish: `update_task(task_code, status="done")`
hand back: `update_task(task_code, status="ready", claimed_by=null)`
add a repo: `POST /api/v1/discovery/scan` then `POST /api/v1/projects` (or UI "Dodaj do monitoringu")
pause a repo: `PATCH /api/v1/projects/<id> {active:false}`

## More
README.md (human quick start, local + Docker); plan.md (roadmap and scope); docs/wsad-do-analizy.md (open architecture questions);
packages/shared (types + Zod), packages/server/src/{api,db,git,mcp}, packages/server/scripts/seed-demo.ts (demo workspace);
tests: `bun test` (server+shared), `bun run test:web`.
