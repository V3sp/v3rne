import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/loader";

describe("config loader", () => {
  test("returns defaults when file is missing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const cfgPath = path.join(dir, "config.yaml");
    const cfg = await loadConfig(cfgPath);
    expect(cfg.port).toBe(4321);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.git_poll_interval_sec).toBe(300);
    expect(cfg.max_attachment_bytes).toBe(10485760);
    expect(cfg.mcp_attachment_max_bytes).toBe(5242880);
    expect(cfg.defaults.scan_depth).toBe(2);
    expect(cfg.defaults.plan_dirs).toEqual(["context", "docs"]);
    expect(cfg.defaults.plan_dir_exclude).toEqual(["archive", "node_modules", ".git"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects absolute or escaping plan_dirs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const cfgPath = path.join(dir, "config.yaml");

    for (const value of ["/abs/context", "../context", "docs/../../secret"]) {
      writeFileSync(cfgPath, `defaults:\n  plan_dirs: ["${value}"]\n`, "utf8");
      await expect(loadConfig(cfgPath)).rejects.toThrow();
    }

    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects plan_dir_exclude entries that are not plain names", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const cfgPath = path.join(dir, "config.yaml");

    for (const value of ["archive/old", "..", "."]) {
      writeFileSync(cfgPath, `defaults:\n  plan_dir_exclude: ["${value}"]\n`, "utf8");
      await expect(loadConfig(cfgPath)).rejects.toThrow();
    }

    rmSync(dir, { recursive: true, force: true });
  });

  test("overrides max_attachment_bytes from file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const cfgPath = path.join(dir, "config.yaml");
    writeFileSync(cfgPath, "max_attachment_bytes: 5242880\nport: 9999\n", "utf8");
    const cfg = await loadConfig(cfgPath);
    expect(cfg.max_attachment_bytes).toBe(5242880);
    expect(cfg.mcp_attachment_max_bytes).toBe(5242880);
    expect(cfg.port).toBe(9999);
    rmSync(dir, { recursive: true, force: true });
  });

  test("overrides mcp_attachment_max_bytes from file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const cfgPath = path.join(dir, "config.yaml");
    writeFileSync(cfgPath, "mcp_attachment_max_bytes: 1024\n", "utf8");
    const cfg = await loadConfig(cfgPath);
    expect(cfg.mcp_attachment_max_bytes).toBe(1024);
    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects a non-positive or fractional mcp_attachment_max_bytes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const cfgPath = path.join(dir, "config.yaml");

    for (const value of ["0", "-1", "1.5"]) {
      writeFileSync(cfgPath, `mcp_attachment_max_bytes: ${value}\n`, "utf8");
      await expect(loadConfig(cfgPath)).rejects.toThrow();
    }

    rmSync(dir, { recursive: true, force: true });
  });

  test("defaults scan_depth when defaults omitted", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-"));
    const cfgPath = path.join(dir, "config.yaml");
    writeFileSync(cfgPath, "workspace_root: /tmp/ws\n", "utf8");
    const cfg = await loadConfig(cfgPath);
    expect(cfg.workspace_root).toBe("/tmp/ws");
    expect(cfg.defaults.scan_depth).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });
});