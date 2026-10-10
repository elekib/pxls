import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "@/lib/db/migrations";
import { migrate, openDb, openMemoryDb } from "@/lib/db/sqlite";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), "pxls-db-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const tables = (db: ReturnType<typeof openMemoryDb>) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );

describe("database", () => {
  it("creates the shared schema", () => {
    const db = openMemoryDb();
    expect(tables(db)).toEqual(
      expect.arrayContaining(["app_config", "login_attempts", "meta", "schema_version", "sessions", "users", "webhook_events", "webhooks"]),
    );
    expect(db.prepare("SELECT version FROM schema_version ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("is idempotent", () => {
    const db = openMemoryDb();
    migrate(db, MIGRATIONS);
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_version").get()).toEqual({ n: 2 });
  });

  it("refuses a database from a newer build", () => {
    const db = openMemoryDb();
    db.prepare("INSERT INTO schema_version (version, name) VALUES (99, 'future')").run();
    expect(() => migrate(db, MIGRATIONS)).toThrow(/schema version 99/);
  });

  it("applies a migration that lands with a lower number later", () => {
    const later = { version: 3, name: "later", sql: "CREATE TABLE later (a)" };
    const db = openMemoryDb([later]);
    migrate(db, [...MIGRATIONS, later]);
    expect(tables(db)).toEqual(expect.arrayContaining(["users", "later"]));
  });

  it("opens a private WAL file on disk and reopens it", () => {
    const dir = tempDir();
    const db = openDb(dir);
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(statSync(path.join(dir, "pxls.db")).mode & 0o777).toBe(0o600);
    db.prepare("INSERT INTO meta (key, value) VALUES ('k', 'v')").run();
    db.close();
    expect(openDb(dir).prepare("SELECT value FROM meta WHERE key = 'k'").get()).toEqual({ value: "v" });
  });
});
