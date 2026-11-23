import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, type Config } from "./schema";
import { configPath } from "../paths";

export function getDefaultConfigPath(): string {
  return configPath();
}

export async function loadConfig(filePath?: string): Promise<Config> {
  const target = filePath ?? getDefaultConfigPath();
  let raw: unknown = {};
  try {
    const text = await readFile(target, "utf8");
    const parsed = parseYaml(text);
    raw = parsed ?? {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw err;
    }
    raw = {};
  }
  return ConfigSchema.parse(raw);
}