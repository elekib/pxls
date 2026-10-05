-- Initial schema: replaces config.json, webhooks.json and webhook_events.json.
-- Do not edit once released; add a new numbered file instead.

-- Free-form key/value bookkeeping (for example the JSON import marker).
CREATE TABLE meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

-- The whole app configuration (pages, device settings, credentials) as one JSON
-- document. Single row, enforced by the CHECK.
CREATE TABLE app_config (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    json       TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Enhanced webhooks. Scalars are typed columns; the remaining free-form
-- settings (rules, actions, display options) live in `config` as JSON.
-- `secret` is sensitive. `position` keeps the order shown in the UI.
CREATE TABLE webhooks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    position   INTEGER NOT NULL,
    name       TEXT NOT NULL,
    path       TEXT NOT NULL,
    enabled    INTEGER NOT NULL,
    secret     TEXT NOT NULL,
    log_events INTEGER NOT NULL,
    max_events INTEGER NOT NULL,
    config     TEXT NOT NULL
);
CREATE INDEX idx_webhooks_position ON webhooks(position);

-- Received webhook events, oldest first by `seq`. Events are keyed by webhook
-- name without a foreign key on purpose: they outlive a deleted webhook, as
-- they did in webhook_events.json.
CREATE TABLE webhook_events (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    id           TEXT NOT NULL,
    webhook_name TEXT NOT NULL,
    timestamp    TEXT NOT NULL,
    processed    INTEGER NOT NULL,
    matched_rule TEXT,
    error        TEXT,
    actions      TEXT NOT NULL,
    payload      TEXT NOT NULL
);
CREATE INDEX idx_webhook_events_name_seq ON webhook_events(webhook_name, seq);
