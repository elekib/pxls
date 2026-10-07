// The SQLite database, `<data dir>/pxls.db`, shared with the Rust 0.1.x app:
// same file, pragmas and migrations, so switching between them keeps all data.
// Port of backend/src/database/db.rs and migrations.rs.
//
// Uses Node's built-in node:sqlite (no native addon). One connection per
// process; SQLite (WAL plus busy timeout) serialises writers across processes.

import { closeSync, mkdirSync, openSync, constants as fsc } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, type Migration } from "./migrations";

export const DB_FILE = "pxls.db";
const BUSY_TIMEOUT_MS = 10_000;

export type Db = DatabaseSync;

export function dataDir(): string {
  return process.env.PXLS_DATA_DIR || "/app/data";
}

/** Open (creating if needed) `<dir>/pxls.db` and bring the schema up to date. */
export function openDb(dir = dataDir(), migrations: Migration[] = MIGRATIONS): Db {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, DB_FILE);
  createPrivateFile(file);

  const db = new DatabaseSync(file);
  // Timeout first, so the pragmas below wait instead of failing.
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA foreign_keys = ON");
  const mode = db.prepare("PRAGMA journal_mode = WAL").get() as { journal_mode: string };
  if (mode.journal_mode.toLowerCase() !== "wal") {
    throw new Error(`could not enable WAL mode (got ${mode.journal_mode})`);
  }
  db.exec("PRAGMA synchronous = NORMAL");
  migrate(db, migrations);
  return db;
}

/** In-memory database with the full schema, for tests. */
export function openMemoryDb(migrations: Migration[] = MIGRATIONS): Db {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, migrations);
  return db;
}

/** The database holds credentials, so create it owner-only. */
function createPrivateFile(file: string) {
  try {
    closeSync(openSync(file, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL, 0o600));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

/**
 * Run `fn` in a write transaction (BEGIN IMMEDIATE takes the write lock up
 * front, like the Rust code). Rolls back if `fn` throws.
 */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Apply every migration not yet recorded in `schema_version`, each in its own
 * transaction. Matched by version number, not "highest applied". A version this
 * build does not know means a newer pxls created the file: refuse to run.
 */
export function migrate(db: Db, migrations: Migration[]) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY NOT NULL,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`);
  const known = new Set(migrations.map((m) => m.version));
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_version").all() as { version: number }[]).map((r) => r.version),
  );
  for (const v of applied) {
    if (!known.has(v)) {
      throw new Error(
        `pxls.db has schema version ${v} which this build does not know; it was created by a newer pxls. Upgrade pxls or restore an older backup`,
      );
    }
  }
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    tx(db, () => {
      const done = db.prepare("SELECT 1 FROM schema_version WHERE version = ?").get(m.version);
      if (done) return;
      try {
        db.exec(m.sql);
      } catch (e) {
        throw new Error(`Migration ${String(m.version).padStart(4, "0")}_${m.name} failed: ${(e as Error).message}`);
      }
      db.prepare("INSERT INTO schema_version (version, name) VALUES (?, ?)").run(m.version, m.name);
      console.log(`[db] applied migration ${String(m.version).padStart(4, "0")}_${m.name}`);
    });
  }
}

declare global {
  var __pxlsDb: Db | undefined;
}

/** The process-wide connection. */
export function getDb(): Db {
  globalThis.__pxlsDb ??= openDb();
  return globalThis.__pxlsDb;
}
