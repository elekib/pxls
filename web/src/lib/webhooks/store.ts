// Webhooks and their event log in pxls.db.

import { randomBytes } from "node:crypto";
import { tx, type Db } from "@/lib/db/sqlite";
import { parseWebhook, type Json, type Webhook, type WebhookEvent } from "./model";

/** Stored as typed columns; everything else goes into the JSON `config` column. */
const COLUMNS = ["name", "path", "enabled", "secret", "log_events", "max_events"] as const;
/** Overall cap on stored events, across all webhooks. */
export const MAX_TOTAL_EVENTS = 1000;

export const MIN_WEBHOOK_SECRET_LEN = 16;
/** 64 hex characters. */
export const generateSecret = () => randomBytes(32).toString("hex");

type Row = Record<string, unknown>;

export function loadWebhooks(db: Db): Webhook[] {
  const rows = db
    .prepare("SELECT name, path, enabled, secret, log_events, max_events, config FROM webhooks ORDER BY position, id")
    .all() as Row[];
  return rows.map((r) => {
    const settings = JSON.parse(String(r.config)) as Record<string, unknown>;
    return parseWebhook({
      ...settings,
      name: r.name,
      path: r.path,
      enabled: Number(r.enabled) !== 0,
      secret: r.secret,
      log_events: Number(r.log_events) !== 0,
      max_events: Math.max(0, Number(r.max_events)),
    });
  });
}

/** Replace all webhooks, keeping the given order. */
export function replaceWebhooks(db: Db, webhooks: Webhook[]): void {
  tx(db, () => {
    db.prepare("DELETE FROM webhooks").run();
    const ins = db.prepare(
      `INSERT INTO webhooks (position, name, path, enabled, secret, log_events, max_events, config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    webhooks.forEach((w, position) => {
      const rest: Record<string, unknown> = { ...w };
      for (const k of COLUMNS) delete rest[k];
      ins.run(position, w.name, w.path, w.enabled ? 1 : 0, w.secret, w.log_events ? 1 : 0, w.max_events, JSON.stringify(rest));
    });
  });
}

/** Give every webhook without a secret a random one. Returns how many were set. */
export function ensureSecrets(db: Db): number {
  const webhooks = loadWebhooks(db);
  let changed = 0;
  for (const w of webhooks) {
    if (!w.secret) {
      w.secret = generateSecret();
      changed++;
    }
  }
  if (changed) replaceWebhooks(db, webhooks);
  return changed;
}

/** Find by path or name. */
export const findWebhook = (list: Webhook[], name: string) => list.find((w) => w.path === name || w.name === name);

// ---- events ---------------------------------------------------------------

function toEvent(r: Row): WebhookEvent {
  return {
    id: String(r.id),
    webhook_name: String(r.webhook_name),
    timestamp: String(r.timestamp),
    payload: JSON.parse(String(r.payload)) as Json,
    processed: Number(r.processed) !== 0,
    actions_taken: JSON.parse(String(r.actions)) as string[],
    error: (r.error as string | null) ?? null,
    matched_rule: (r.matched_rule as string | null) ?? null,
  };
}

/** Append an event, then trim to `maxPerWebhook` for its webhook and MAX_TOTAL_EVENTS overall. */
export function logEvent(db: Db, e: WebhookEvent, maxPerWebhook: number): void {
  tx(db, () => {
    db.prepare(
      `INSERT INTO webhook_events (id, webhook_name, timestamp, processed, matched_rule, error, actions, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(e.id, e.webhook_name, e.timestamp, e.processed ? 1 : 0, e.matched_rule, e.error, JSON.stringify(e.actions_taken), JSON.stringify(e.payload));
    db.prepare(
      `DELETE FROM webhook_events WHERE webhook_name = ? AND seq NOT IN (
         SELECT seq FROM webhook_events WHERE webhook_name = ? ORDER BY seq DESC LIMIT ?)`,
    ).run(e.webhook_name, e.webhook_name, maxPerWebhook);
    db.prepare(
      `DELETE FROM webhook_events WHERE seq NOT IN (
         SELECT seq FROM webhook_events ORDER BY seq DESC LIMIT ?)`,
    ).run(MAX_TOTAL_EVENTS);
  });
}

/** Events newest first, optionally for one webhook and limited. */
export function recentEvents(db: Db, webhookName: string | null, limit: number | null): WebhookEvent[] {
  return (
    db
      .prepare(
        `SELECT id, webhook_name, timestamp, processed, matched_rule, error, actions, payload
         FROM webhook_events WHERE (? IS NULL OR webhook_name = ?) ORDER BY seq DESC LIMIT ?`,
      )
      .all(webhookName, webhookName, limit ?? -1) as Row[]
  ).map(toEvent);
}

export function clearEvents(db: Db, webhookName: string | null): void {
  if (webhookName === null) db.prepare("DELETE FROM webhook_events").run();
  else db.prepare("DELETE FROM webhook_events WHERE webhook_name = ?").run(webhookName);
}

/** RFC 3339 UTC timestamp with nanoseconds. */
export function nowTimestamp(): string {
  const d = new Date();
  const ns = String(d.getUTCMilliseconds()).padStart(3, "0") + "000000";
  return d.toISOString().replace(/\.\d{3}Z$/, `.${ns}Z`);
}
