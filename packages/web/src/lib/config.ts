import type { Project } from "@v3rne/shared";

type ConfigProject = Pick<Project, "id" | "relPath" | "active" | "planFiles" | "agentDocs">;

/** Read-only mirror of the `projects:` section of /app/data/config.yaml. */
export function buildConfigPreview(projects: readonly ConfigProject[]): string {
  if (projects.length === 0) return "projects: []";

  const lines = ["projects:"];
  for (const project of projects) {
    lines.push(
      `  - id: ${project.id}`,
      `    path: ${project.relPath}`,
      `    active: ${project.active}`,
      `    plan_files: [${project.planFiles.join(", ")}]`,
      `    agent_docs: [${project.agentDocs.join(", ")}]`,
    );
  }
  return lines.join("\n");
}

/** API does not expose `defaults.plan_dirs`; this mirrors the README_AI.md example. */
export const CONFIG_DEFAULT_PLAN_DIRS_HINT = ["context", "docs"] as const;

/** Trims, unifies separators, drops empty entries and duplicates; keeps the first occurrence's order. */
export function normalizePathList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const path = normalizePath(raw);
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

function normalizePath(raw: string): string {
  let path = raw.trim().replace(/\\/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  while (path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

/** Returns a Polish message for an invalid relative path, or null when it is acceptable. */
export function validateRelativePath(raw: string): string | null {
  const path = normalizePath(raw);
  if (path.length === 0) return "Ścieżka nie może być pusta.";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    return `„${path}” jest ścieżką bezwzględną. Podaj ścieżkę względną.`;
  }
  if (path.split("/").includes("..")) return `„${path}” nie może zawierać „..”.`;
  return null;
}

/** First problem found in a list of paths, or null. Entries are validated after normalization. */
export function validatePathList(values: readonly string[]): string | null {
  for (const value of normalizePathList(values)) {
    const problem = validateRelativePath(value);
    if (problem) return problem;
  }
  return null;
}

export interface ProjectFormValues {
  name: string;
  codePrefix: string;
  relPath: string;
  /** True sends `planDirs: null`, so the project falls back to the config default. */
  useDefaultPlanDirs: boolean;
  planDirs: string[];
  planFiles: string[];
  agentDocs: string[];
}

export type ProjectFormErrors = Partial<Record<keyof ProjectFormValues, string>>;

export type ConfigEditableProject = Pick<
  Project,
  "name" | "codePrefix" | "relPath" | "planFiles" | "planDirs" | "planDirsOverride" | "agentDocs"
>;

export function projectFormValues(project: ConfigEditableProject): ProjectFormValues {
  return {
    name: project.name,
    codePrefix: project.codePrefix,
    relPath: project.relPath,
    useDefaultPlanDirs: !project.planDirsOverride,
    planDirs: [...project.planDirs],
    planFiles: [...project.planFiles],
    agentDocs: [...project.agentDocs],
  };
}

export function validateProjectForm(values: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {};
  if (values.name.trim().length === 0) errors.name = "Nazwa nie może być pusta.";
  if (values.codePrefix.trim().length === 0) errors.codePrefix = "Prefiks nie może być pusty.";

  const relPathProblem = validateRelativePath(values.relPath);
  if (relPathProblem) errors.relPath = relPathProblem;

  if (!values.useDefaultPlanDirs) {
    const planDirsProblem = validatePathList(values.planDirs);
    if (planDirsProblem) errors.planDirs = planDirsProblem;
  }
  const planFilesProblem = validatePathList(values.planFiles);
  if (planFilesProblem) errors.planFiles = planFilesProblem;
  const agentDocsProblem = validatePathList(values.agentDocs);
  if (agentDocsProblem) errors.agentDocs = agentDocsProblem;

  return errors;
}

/** Body of `PATCH /projects/:id`; contains only the fields that differ from the project. */
export type ProjectPatch = Partial<{
  name: string;
  codePrefix: string;
  relPath: string;
  planDirs: string[] | null;
  planFiles: string[];
  agentDocs: string[];
}>;

export function buildProjectPatch(project: ConfigEditableProject, values: ProjectFormValues): ProjectPatch {
  const patch: ProjectPatch = {};

  const name = values.name.trim();
  if (name !== project.name) patch.name = name;

  const codePrefix = values.codePrefix.trim();
  if (codePrefix !== project.codePrefix) patch.codePrefix = codePrefix;

  const relPath = normalizePath(values.relPath);
  if (relPath !== project.relPath) patch.relPath = relPath;

  const planDirsPatch = buildPlanDirsPatch(project, values);
  if (planDirsPatch !== undefined) patch.planDirs = planDirsPatch;

  const planFiles = normalizePathList(values.planFiles);
  if (!sameList(planFiles, project.planFiles)) patch.planFiles = planFiles;

  const agentDocs = normalizePathList(values.agentDocs);
  if (!sameList(agentDocs, project.agentDocs)) patch.agentDocs = agentDocs;

  return patch;
}

/** `undefined` means "unchanged", so the key is left out of the PATCH body. */
function buildPlanDirsPatch(project: ConfigEditableProject, values: ProjectFormValues): string[] | null | undefined {
  if (values.useDefaultPlanDirs) {
    return project.planDirsOverride ? null : undefined;
  }
  const planDirs = normalizePathList(values.planDirs);
  // Leaving the default must send the list even when it equals the default, otherwise the override is never stored.
  if (project.planDirsOverride && sameList(planDirs, project.planDirs)) return undefined;
  return planDirs;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function planDirsBadge(project: Pick<Project, "planDirsOverride">): "domyślne" | "własne" {
  return project.planDirsOverride ? "własne" : "domyślne";
}
