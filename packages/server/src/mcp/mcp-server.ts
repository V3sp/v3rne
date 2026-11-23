import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ApiDeps } from "../api/tasks";
import { TOOL_INPUT_SCHEMAS, createToolHandlers, type McpToolHandlers } from "./tools";

const SERVER_INFO = { name: "v3rne", version: "0.1.0" };

/**
 * Stateless Streamable HTTP MCP endpoint.
 *
 * The SDK forbids reusing a stateless transport, so every HTTP request gets its
 * own server+transport pair. Tool state lives in SQLite, so nothing is lost.
 */
export function createMcpRouter(deps: ApiDeps): Hono {
  const handlers = createToolHandlers(deps);
  const router = new Hono();

  router.all("/", async (c) => {
    if (c.req.method !== "POST") {
      // No session state and no server-initiated notifications, so there is no
      // GET stream to open (an SSE stream here would never end).
      if (c.req.method === "DELETE") return c.body(null, 204);
      return c.text("Method Not Allowed", 405, { Allow: "POST" });
    }

    const server = createMcpServer(handlers);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);

    return transport.handleRequest(c.req.raw);
  });

  return router;
}

export function createMcpServer(handlers: McpToolHandlers): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "V3rne task tracking. Start with get_next_task (claim=true) and report doubts through add_entry with kind=doubt.",
  });
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "Lists registered projects with their paths, code prefixes and open task counts (ready / in_progress / needs_input).",
      inputSchema: TOOL_INPUT_SCHEMAS.list_projects.shape,
    },
    handlers.listProjects,
  );

  server.registerTool(
    "get_project_context",
    {
      title: "Get project context",
      description:
        "Resolves a project by project_id or by the current working directory and returns plan.md sections, active worktrees and board status.",
      inputSchema: TOOL_INPUT_SCHEMAS.get_project_context.shape,
    },
    handlers.getProjectContext,
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Lists tasks of a project with priorities and the number of open comments and doubts.",
      inputSchema: TOOL_INPUT_SCHEMAS.list_tasks.shape,
    },
    handlers.listTasks,
  );

  server.registerTool(
    "list_doubts",
    {
      title: "List doubts",
      description:
        "Lists open doubts (kind=doubt) across active projects, sorted by task priority then age. Pass project_id to include an inactive project.",
      inputSchema: TOOL_INPUT_SCHEMAS.list_doubts.shape,
    },
    handlers.listDoubts,
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task",
      description:
        "Returns a task by code with its comments, attachments and the last 50 events (oldest first), plus the project name.",
      inputSchema: TOOL_INPUT_SCHEMAS.get_task.shape,
    },
    handlers.getTask,
  );

  server.registerTool(
    "get_next_task",
    {
      title: "Get next task",
      description:
        "Returns the highest-priority ready task (urgent first, then sort_order) with comments and attachments. With claim=true it moves the task to in_progress; an agent that already has a task in progress gets that task back.",
      inputSchema: TOOL_INPUT_SCHEMAS.get_next_task.shape,
    },
    handlers.getNextTask,
  );

  server.registerTool(
    "create_tasks",
    {
      title: "Create tasks",
      description:
        "Creates up to 100 tasks in one transaction, e.g. after breaking plan.md into steps. Returns the generated task codes.",
      inputSchema: TOOL_INPUT_SCHEMAS.create_tasks.shape,
    },
    handlers.createTasks,
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description: "Updates task status, priority, git branch or assignee and records a task event.",
      inputSchema: TOOL_INPUT_SCHEMAS.update_task.shape,
    },
    handlers.updateTask,
  );

  server.registerTool(
    "add_entry",
    {
      title: "Add entry",
      description:
        "Adds a comment, doubt, progress note or decision to a task. kind=doubt also moves the task to needs_input.",
      inputSchema: TOOL_INPUT_SCHEMAS.add_entry.shape,
    },
    handlers.addEntry,
  );

  server.registerTool(
    "get_attachment",
    {
      title: "Get attachment",
      description:
        "Returns an attachment: images as a native MCP image block (base64), text files and logs as text. Files above 5 MB are rejected.",
      inputSchema: TOOL_INPUT_SCHEMAS.get_attachment.shape,
    },
    handlers.getAttachment,
  );

  return server;
}
