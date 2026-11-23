import { z } from "zod";

/** Repo-relative directory: no absolute paths and no `..` segments. */
const RelativeDirSchema = z
  .string()
  .min(1)
  .refine((value) => {
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return false;
    return !value.split(/[\\/]+/).includes("..");
  }, "must be a relative path without '..'");

const DirNameSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !value.includes("/") && !value.includes("\\") && value !== "." && value !== "..",
    "must be a plain directory name",
  );

export const ConfigSchema = z.object({
  workspace_root: z.string().optional(),
  port: z.number().int().positive().default(4321),
  host: z.string().min(1).default("127.0.0.1"),
  git_poll_interval_sec: z.number().int().positive().default(300),
  max_attachment_bytes: z.number().int().positive().default(10485760),
  /** Upper bound for an attachment returned through the MCP `get_attachment` tool. */
  mcp_attachment_max_bytes: z.number().int().positive().default(5242880),
  defaults: z
    .object({
      plan_files: z
        .array(z.string())
        .default(["plan.md", "PLAN.md", "docs/plan.md", "docs/PRD.md"]),
      /** Repo-relative directories scanned recursively (depth 3) for `*.md` plan files. */
      plan_dirs: z.array(RelativeDirSchema).default(["context", "docs"]),
      /** Directory names skipped at every scanned level. */
      plan_dir_exclude: z.array(DirNameSchema).default(["archive", "node_modules", ".git"]),
      agent_docs: z
        .array(z.string())
        .default(["AGENTS.md", "CLAUDE.md", "README_AI.md", ".cursorrules"]),
      scan_depth: z.number().int().nonnegative().default(2),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;