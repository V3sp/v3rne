import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "./plan-hash";
import { parseMarkdownHeadings, type PlanHeading } from "./plan-parser";

export interface PlanFileResult {
  /** The path as requested, relative to the repository root. */
  path: string;
  exists: boolean;
  content: string | null;
  /** SHA-256 of the content with normalized line endings; `null` when unreadable. */
  hash: string | null;
  headings: PlanHeading[];
  /** Present for rejected paths and for read errors other than "not found". */
  error?: string;
}

export async function readPlanFiles(
  repoPath: string,
  relativePaths: string[],
): Promise<PlanFileResult[]> {
  const repoRoot = path.resolve(repoPath);
  // Na macOS/Windows system plików jest niewrażliwy na wielkość liter, więc `plan.md`
  // i `PLAN.md` wskazują ten sam plik. Czytamy go raz, żeby nie dublować sekcji.
  const seen = new Set<string>();
  const uniquePaths = relativePaths.filter((relativePath) => {
    const key = relativePath.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return Promise.all(uniquePaths.map((relativePath) => readPlanFile(repoRoot, relativePath)));
}

async function readPlanFile(repoRoot: string, relativePath: string): Promise<PlanFileResult> {
  const result: PlanFileResult = {
    path: relativePath,
    exists: false,
    content: null,
    hash: null,
    headings: [],
  };

  const rejection = validateRelativePath(repoRoot, relativePath);
  if (rejection) return { ...result, error: rejection };

  try {
    const content = await readFile(path.resolve(repoRoot, relativePath), "utf8");
    return {
      ...result,
      exists: true,
      content,
      hash: sha256Hex(content),
      headings: parseMarkdownHeadings(content),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // A missing plan file is an expected state, reported through `exists`.
    if (code === "ENOENT" || code === "ENOTDIR") return result;
    const message = err instanceof Error ? err.message : String(err);
    return { ...result, error: message };
  }
}

/** Returns a rejection reason, or `null` when the path stays inside the repo. */
export function validateRelativePath(repoRoot: string, relativePath: string): string | null {
  if (relativePath.trim().length === 0) return "Path is empty";
  if (path.isAbsolute(relativePath)) return "Path must be relative to the repository root";

  const relative = path.relative(path.resolve(repoRoot), path.resolve(repoRoot, relativePath));
  if (relative === "") return "Path points at the repository root, expected a file";
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return "Path escapes the repository root";
  }
  return null;
}
