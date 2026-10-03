import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import { dataDir } from "../paths";
import * as schema from "./schema";

/**
 * Миграции по порядку; номер применённой хранится в PRAGMA user_version.
 * Новые миграции только добавлять в конец, старые не менять.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE providers (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     label TEXT NOT NULL,
     api_key_enc TEXT,
     api_key_hint TEXT,
     base_url TEXT,
     models TEXT NOT NULL DEFAULT '[]',
     enabled INTEGER NOT NULL DEFAULT 1,
     last_check TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  `ALTER TABLE providers ADD COLUMN default_model TEXT;
   CREATE TABLE cases (
     id TEXT PRIMARY KEY,
     parent_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
     status TEXT NOT NULL,
     material_text TEXT NOT NULL,
     comment TEXT NOT NULL DEFAULT '',
     case_file TEXT,
     participants TEXT,
     verdict TEXT,
     error TEXT,
     rounds INTEGER NOT NULL DEFAULT 0,
     input_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX cases_created ON cases(created_at);
   CREATE TABLE case_events (
     case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL,
     type TEXT NOT NULL,
     payload TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (case_id, seq)
   );`,
  `CREATE TABLE case_files (
     id TEXT PRIMARY KEY,
     case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     mime TEXT NOT NULL,
     kind TEXT NOT NULL,
     size INTEGER NOT NULL,
     path TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX case_files_case ON case_files(case_id);
   ALTER TABLE cases ADD COLUMN progress TEXT;`,
  `ALTER TABLE cases ADD COLUMN appeal TEXT;
   ALTER TABLE cases ADD COLUMN actual_result TEXT;
   CREATE INDEX cases_parent ON cases(parent_id);`,
  // Повторное рассмотрение (новая версия материала), учёт кэшированных токенов,
  // порог разброса 10 → 6, если пользователь его не менял
  `ALTER TABLE cases ADD COLUMN previous_id TEXT REFERENCES cases(id) ON DELETE SET NULL;
   ALTER TABLE cases ADD COLUMN revision TEXT;
   ALTER TABLE cases ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX cases_previous ON cases(previous_id);
   UPDATE settings SET value = json_set(value, '$.spreadThreshold', 6)
     WHERE key = 'app' AND json_extract(value, '$.spreadThreshold') = 10;`,
];

export type Db = BetterSQLite3Database<typeof schema>;

function migrate(sqlite: Database.Database) {
  const current = sqlite.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    sqlite.transaction(() => {
      sqlite.exec(MIGRATIONS[i]);
      sqlite.pragma(`user_version = ${i + 1}`);
    })();
  }
}

export function openDb(file: string): Db {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  return drizzle(sqlite, { schema });
}

// Один экземпляр на процесс; в dev переживает hot reload.
const globalForDb = globalThis as unknown as { verdictDb?: Db };

export function db(): Db {
  globalForDb.verdictDb ??= openDb(path.join(dataDir(), "verdict.db"));
  return globalForDb.verdictDb;
}

export { schema };
