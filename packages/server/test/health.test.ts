import { describe, expect, test } from "bun:test";
import { createApp } from "../src/index";

describe("health", () => {
  test("GET /api/v1/health returns ok", async () => {
    const app = createApp();
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});