import type { Project } from "@v3rne/shared";
import type { ProjectPatch } from "../lib/config";
import { ApiError, apiRequest } from "./client";

export interface DiscoveredRepo {
  relPath: string;
  name: string;
  alreadyRegistered: boolean;
}

/** Only toggles monitoring; the server keeps every other project field unchanged. */
export function setProjectActive(projectId: string, active: boolean): Promise<Project> {
  return apiRequest<Project>(`/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
}

/** Sends only the fields present in `patch`; 400 and 409 (`code_prefix_locked`) come back as ApiError. */
export function updateProject(projectId: string, patch: ProjectPatch): Promise<Project> {
  return apiRequest<Project>(`/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Scanning never registers repositories; use `registerDiscoveredRepo` for that. */
export async function scanWorkspace(): Promise<DiscoveredRepo[]> {
  const body = await apiRequest<{ repos: DiscoveredRepo[] }>("/discovery/scan", {
    method: "POST",
  });
  return body.repos;
}

/** `Moje Repo 2` -> `moje-repo-2`; polskie znaki są transliterowane, nie gubione. */
export function slugifyRepoName(name: string): string {
  const slug = name
    .replace(/[ąćęłńóśźż]/gi, (char) => POLISH_MAP[char.toLowerCase()] ?? char)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "repo";
}

const POLISH_MAP: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

/**
 * `workflow-core` -> `WC` (inicjały części), `transit` -> `TRANS` (pierwsze litery).
 * Zawsze 2-5 wielkich liter.
 */
export function codePrefixForName(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const lettersOnly = name.replace(/[^A-Za-z]/g, "").toUpperCase();

  let base: string;
  if (words.length >= 2) {
    base = words
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 5);
  } else {
    base = lettersOnly.slice(0, 5);
  }

  if (base.length >= 2) return base;
  return `${base}${lettersOnly}`.slice(0, 2).padEnd(2, "X");
}

export interface RegisterRepoOptions {
  name: string;
  relPath: string;
  /** Base id; a numeric suffix is added when the id is already taken. */
  id?: string;
  codePrefix?: string;
}

/**
 * Registers a discovered repository and returns the created project.
 * Retries with a numeric id suffix when the slug already exists (409 id_taken).
 */
export async function registerDiscoveredRepo(options: RegisterRepoOptions): Promise<Project> {
  const baseId = options.id ?? slugifyRepoName(options.name);
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = attempt === 0 ? baseId : `${baseId}-${attempt + 1}`;
    try {
      return await apiRequest<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({
          id,
          codePrefix: options.codePrefix ?? codePrefixForName(options.name),
          name: options.name,
          relPath: options.relPath,
        }),
      });
    } catch (error) {
      lastError = error;
      const isIdConflict = error instanceof ApiError && error.code === "id_taken";
      if (!isIdConflict) throw error;
    }
  }

  throw lastError ?? new Error("Nie udało się zarejestrować projektu");
}
