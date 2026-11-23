import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadConfig } from "./config/loader";
import type { Config } from "./config/schema";
import { openDatabase, runMigrations } from "./db";
import type { Database } from "bun:sqlite";
import { createProjectsRouter } from "./api/projects";
import { createTasksRouter } from "./api/tasks";
import { createAttachmentsRouter } from "./api/attachments";
import { createStatsRouter } from "./api/stats";
import { startGitPoller } from "./git-poller";
import { createMcpRouter } from "./mcp";
import { defaultDataDir } from "./paths";

export interface AppDeps {
  db: Database;
  config: Config;
  dataDir?: string;
  webDistDir?: string;
}

const DEFAULT_WEB_DIST = resolve(import.meta.dir, "../../web/dist");

export function createApp(deps?: AppDeps) {
  const app = new Hono();
  app.get("/api/v1/health", (c) => c.json({ status: "ok" }));

  if (deps) {
    const { db, config, dataDir } = deps;
    app.route("/api/v1", createProjectsRouter({ db, config }));
    app.route("/api/v1", createTasksRouter({ db, config, dataDir }));
    app.route("/api/v1", createAttachmentsRouter({ db, config, dataDir }));
    app.route("/api/v1", createStatsRouter({ db, config, dataDir }));
    app.route("/mcp", createMcpRouter({ db, config, dataDir }));

    const webDist = deps.webDistDir ?? process.env.WEB_DIST ?? DEFAULT_WEB_DIST;
    if (existsSync(resolve(webDist, "index.html"))) {
      const root = relative(process.cwd(), webDist) || ".";
      app.use("/*", serveStatic({ root }));
      app.get("*", async (c) => {
        if (c.req.path.startsWith("/api/")) {
          return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
        }
        return c.html(await Bun.file(resolve(webDist, "index.html")).text());
      });
    }
  }

  return app;
}

const DEFAULT_DATA_DIR = defaultDataDir();

async function main() {
  const config = await loadConfig();
  const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
  const db = openDatabase(`${dataDir}/board.db`);
  runMigrations(db);
  const app = createApp({ db, config, dataDir });
  const poller = startGitPoller(db, config);

  const shutdown = () => {
    poller.stop();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const port = config.port;
  const hostname = process.env.HOST ?? config.host;

  Bun.serve({
    fetch: app.fetch,
    port,
    hostname,
  });

  console.log(`V3rne server listening on http://${hostname}:${port}`);
}

if (import.meta.main) {
  void main();
}

export { loadConfig };
