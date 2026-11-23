import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function openDatabase(filePath?: string): Database {
  const target = filePath ?? path.join(process.env.DATA_DIR ?? "./data", "board.db");
  if (target !== ":memory:") {
    mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new Database(target);
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");
  return db;
}