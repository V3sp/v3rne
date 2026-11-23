import type { Config } from "./config/schema";

let warnedAboutConfigRoot = false;

/**
 * Jedno źródło prawdy dla katalogu z repozytoriami: `WORKSPACE_PATH` z `.env`.
 * `workspace_root` w `config.yaml` zostaje wyłącznie jako zgodnościowy fallback
 * dla starszych instalacji i jest ignorowany, gdy zmienna jest ustawiona.
 */
export function resolveWorkspaceRoot(config: Config): string | null {
  const fromEnv = process.env.WORKSPACE_PATH?.trim();
  const fromConfig = config.workspace_root?.trim();

  if (fromEnv && fromConfig && fromEnv !== fromConfig && !warnedAboutConfigRoot) {
    warnedAboutConfigRoot = true;
    console.warn(
      `[workspace] WORKSPACE_PATH=${fromEnv} nadpisuje workspace_root=${fromConfig} z config.yaml. ` +
        "Ustaw workspace tylko w .env i usuń workspace_root z config.yaml.",
    );
  }

  return fromEnv || fromConfig || null;
}
