//! Typed reads and writes for the tables. Pure functions over a connection or
//! transaction; callers decide transaction boundaries.

use anyhow::{Context, Result};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{Map, Value};

use crate::config::Config;
use crate::webhook_enhanced::{EnhancedWebhookConfig, WebhookEvent};

/// Fields stored as typed columns; everything else goes into the JSON column.
const WEBHOOK_COLUMNS: [&str; 6] = [
    "name",
    "path",
    "enabled",
    "secret",
    "log_events",
    "max_events",
];

/// Overall cap on stored events, across all webhooks.
pub const MAX_TOTAL_EVENTS: i64 = 1000;

// ---- config -------------------------------------------------------------

pub fn load_config(conn: &Connection) -> Result<Option<Config>> {
    let json: Option<String> = conn
        .query_row("SELECT json FROM app_config WHERE id = 1", [], |r| r.get(0))
        .optional()?;
    json.map(|j| serde_json::from_str(&j).context("Failed to parse stored config"))
        .transpose()
}

pub fn save_config(conn: &Connection, config: &Config) -> Result<()> {
    let json = serde_json::to_string(config).context("Failed to serialize config")?;
    conn.execute(
        "INSERT INTO app_config (id, json) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        [json],
    )?;
    Ok(())
}

// ---- webhooks -----------------------------------------------------------

pub fn load_webhooks(conn: &Connection) -> Result<Vec<EnhancedWebhookConfig>> {
    let mut stmt = conn.prepare(
        "SELECT name, path, enabled, secret, log_events, max_events, config
         FROM webhooks ORDER BY position, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, bool>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, bool>(4)?,
            r.get::<_, i64>(5)?,
            r.get::<_, String>(6)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (name, path, enabled, secret, log_events, max_events, config) = row?;
        let mut obj: Map<String, Value> =
            serde_json::from_str(&config).context("Failed to parse stored webhook settings")?;
        obj.insert("name".into(), name.into());
        obj.insert("path".into(), path.into());
        obj.insert("enabled".into(), enabled.into());
        obj.insert("secret".into(), secret.into());
        obj.insert("log_events".into(), log_events.into());
        obj.insert("max_events".into(), max_events.max(0).into());
        out.push(serde_json::from_value(Value::Object(obj)).context("Failed to rebuild webhook")?);
    }
    Ok(out)
}

/// Replace all webhooks, keeping the given order.
pub fn replace_webhooks(conn: &Connection, webhooks: &[EnhancedWebhookConfig]) -> Result<()> {
    conn.execute("DELETE FROM webhooks", [])?;
    let mut stmt = conn.prepare(
        "INSERT INTO webhooks (position, name, path, enabled, secret, log_events, max_events, config)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for (position, w) in webhooks.iter().enumerate() {
        let mut rest = match serde_json::to_value(w)? {
            Value::Object(m) => m,
            _ => unreachable!("webhook serializes to an object"),
        };
        for key in WEBHOOK_COLUMNS {
            rest.remove(key);
        }
        stmt.execute(params![
            position as i64,
            w.name,
            w.path,
            w.enabled,
            w.secret.0,
            w.log_events,
            w.max_events as i64,
            serde_json::to_string(&rest)?,
        ])?;
    }
    Ok(())
}

// ---- events -------------------------------------------------------------

pub fn insert_event(conn: &Connection, e: &WebhookEvent) -> Result<()> {
    conn.execute(
        "INSERT INTO webhook_events
            (id, webhook_name, timestamp, processed, matched_rule, error, actions, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            e.id,
            e.webhook_name,
            e.timestamp.to_rfc3339_opts(SecondsFormat::Nanos, true),
            e.processed,
            e.matched_rule,
            e.error,
            serde_json::to_string(&e.actions_taken)?,
            serde_json::to_string(&e.payload)?,
        ],
    )?;
    Ok(())
}

pub fn replace_events(conn: &Connection, events: &[WebhookEvent]) -> Result<()> {
    conn.execute("DELETE FROM webhook_events", [])?;
    for e in events {
        insert_event(conn, e)?;
    }
    Ok(())
}

/// Events oldest first, optionally for one webhook.
pub fn load_events(conn: &Connection, webhook_name: Option<&str>) -> Result<Vec<WebhookEvent>> {
    query_events(conn, webhook_name, false, None)
}

/// Events newest first, optionally for one webhook and limited.
pub fn recent_events(
    conn: &Connection,
    webhook_name: Option<&str>,
    limit: Option<usize>,
) -> Result<Vec<WebhookEvent>> {
    query_events(conn, webhook_name, true, limit)
}

fn query_events(
    conn: &Connection,
    webhook_name: Option<&str>,
    newest_first: bool,
    limit: Option<usize>,
) -> Result<Vec<WebhookEvent>> {
    let sql = format!(
        "SELECT id, webhook_name, timestamp, processed, matched_rule, error, actions, payload
         FROM webhook_events
         WHERE (?1 IS NULL OR webhook_name = ?1)
         ORDER BY seq {}
         LIMIT ?2",
        if newest_first { "DESC" } else { "ASC" }
    );
    let limit = limit.map(|l| l as i64).unwrap_or(-1);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![webhook_name, limit], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, bool>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, String>(7)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, webhook_name, ts, processed, matched_rule, error, actions, payload) = row?;
        out.push(WebhookEvent {
            id,
            webhook_name,
            timestamp: DateTime::parse_from_rfc3339(&ts)
                .context("Bad event timestamp")?
                .with_timezone(&Utc),
            payload: serde_json::from_str(&payload)?,
            processed,
            actions_taken: serde_json::from_str(&actions)?,
            error,
            matched_rule,
        });
    }
    Ok(out)
}

/// Keep only the newest `max_per_webhook` events of one webhook, then only the
/// newest `MAX_TOTAL_EVENTS` overall.
pub fn trim_events(conn: &Connection, webhook_name: &str, max_per_webhook: usize) -> Result<()> {
    conn.execute(
        "DELETE FROM webhook_events
         WHERE webhook_name = ?1 AND seq NOT IN (
             SELECT seq FROM webhook_events WHERE webhook_name = ?1
             ORDER BY seq DESC LIMIT ?2)",
        params![
            webhook_name,
            i64::try_from(max_per_webhook).unwrap_or(i64::MAX)
        ],
    )?;
    conn.execute(
        "DELETE FROM webhook_events WHERE seq NOT IN (
             SELECT seq FROM webhook_events ORDER BY seq DESC LIMIT ?1)",
        [MAX_TOTAL_EVENTS],
    )?;
    Ok(())
}

pub fn clear_events(conn: &Connection, webhook_name: Option<&str>) -> Result<()> {
    match webhook_name {
        Some(name) => conn.execute("DELETE FROM webhook_events WHERE webhook_name = ?1", [name])?,
        None => conn.execute("DELETE FROM webhook_events", [])?,
    };
    Ok(())
}
