import { z } from "zod";

export const ProjectSchema = z.object({
  id: z.string().min(1),
  codePrefix: z.string().min(1),
  name: z.string().min(1),
  relPath: z.string().min(1),
  planFiles: z.array(z.string()).default([]),
  /** Effective plan directories: the stored override or the config default. */
  planDirs: z.array(z.string()).default([]),
  /** True when `planDirs` comes from the project row instead of the config default. */
  planDirsOverride: z.boolean().default(false),
  agentDocs: z.array(z.string()).default([]),
  planHashes: z.record(z.string()).default({}),
  nextTaskSeq: z.number().int().positive().default(1),
  active: z.boolean().default(true),
  createdAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;