import path from "node:path";

/** Katalog główny monorepo (agent-board), niezależny od katalogu, z którego uruchomiono proces. */
export const PROJECT_ROOT = path.resolve(import.meta.dir, "../../..");

/** Domyślny katalog danych: `<repo>/data`, nadpisywany przez DATA_DIR. */
export function defaultDataDir(): string {
  return process.env.DATA_DIR ?? path.join(PROJECT_ROOT, "data");
}

export function configPath(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "config.yaml");
}
