// Load and save the config row, and the browser-safe view of it.

import type { Db } from "@/lib/db/sqlite";
import { defaultConfig, normalizeConfig, type Config } from "./model";

/** The saved config, writing the defaults on first run. */
export function loadConfig(db: Db): Config {
  const row = db.prepare("SELECT json FROM app_config WHERE id = 1").get() as { json: string } | undefined;
  if (!row) {
    const cfg = defaultConfig();
    saveConfig(db, cfg);
    return cfg;
  }
  return normalizeConfig(JSON.parse(row.json));
}

export function saveConfig(db: Db, cfg: Config): void {
  const json = JSON.stringify(cfg, (k, v) => (k === "beszel_token" && v == null ? undefined : v));
  db.prepare(
    `INSERT INTO app_config (id, json) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
  ).run(json);
}

/** Config as sent to the browser: secrets removed, `password_set` instead. */
export function publicConfig(cfg: Config): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone(cfg);
  delete out.beszel_token;
  if (cfg.beszel_auth) {
    out.beszel_auth = { ...cfg.beszel_auth, password: "", password_set: cfg.beszel_auth.password !== "" };
  }
  return out;
}

/**
 * The browser never receives stored secrets, so a config coming back from it
 * has them blank or missing: carry the stored values over unless the request
 * explicitly changes them. Returns whether the Beszel login changed.
 */
export function preserveSecrets(incoming: Config, stored: Config, sentAuth: boolean): boolean {
  if (!sentAuth) {
    // Older clients / stale tabs don't send the field at all.
    incoming.beszel_auth = stored.beszel_auth;
  } else if (incoming.beszel_auth && incoming.beszel_auth.email.trim() === "") {
    // Empty email is how the UI clears the login.
    incoming.beszel_auth = null;
  } else if (incoming.beszel_auth) {
    incoming.beszel_auth.email = incoming.beszel_auth.email.trim();
    if (incoming.beszel_auth.password === "" && stored.beszel_auth) {
      incoming.beszel_auth.password = stored.beszel_auth.password;
    }
  }
  // A real login supersedes the legacy pasted token; otherwise keep it.
  if (incoming.beszel_auth?.password) delete incoming.beszel_token;
  else if (stored.beszel_token) incoming.beszel_token = stored.beszel_token;
  else delete incoming.beszel_token;

  const a = incoming.beszel_auth;
  const b = stored.beszel_auth;
  return a?.email !== b?.email || a?.password !== b?.password;
}
