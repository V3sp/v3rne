import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import { createApp } from "../../src/index";
import { createMcpTestContext, seedProject, type McpTestContext } from "./helpers";

const JSON_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

const TOOL_NAMES = [
  "add_entry",
  "create_tasks",
  "get_attachment",
  "get_next_task",
  "get_project_context",
  "get_task",
  "list_doubts",
  "list_projects",
  "list_tasks",
  "update_task",
];

let ctx: McpTestContext;
let app: Hono;

beforeEach(() => {
  ctx = createMcpTestContext();
  app = createApp({ db: ctx.db, config: ctx.config, dataDir: ctx.dataDir });
});

afterEach(() => {
  ctx.close();
});

function rpc(body: unknown) {
  return app.request("/mcp", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

describe("POST /mcp", () => {
  it("answers initialize", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "agent-board-test", version: "1.0.0" },
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { serverInfo: { name: string }; capabilities: { tools?: unknown } };
    };
    expect(body.result.serverInfo.name).toBe("v3rne");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("lists all ten tools", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual(TOOL_NAMES);
  });

  it("calls list_projects over Streamable HTTP", async () => {
    seedProject(ctx.db, { id: "proj-a", name: "Project A" });

    const res = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_projects", arguments: {} },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      result: { content: { type: string; text: string }[]; isError?: boolean };
    };
    expect(body.result.isError).toBeUndefined();
    const text = body.result.content[0];
    expect(text?.type).toBe("text");
    const payload = JSON.parse(text?.text ?? "{}") as { projects: { id: string }[] };
    expect(payload.projects.map((project) => project.id)).toEqual(["proj-a"]);
  });

  it("rejects unknown tools with a tool error", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "not_a_tool", arguments: {} },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { isError?: boolean; content: { type: string; text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toContain("not_a_tool");
  });

  it("does not open an SSE stream on GET", async () => {
    const res = await app.request("/mcp", {
      method: "GET",
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});
