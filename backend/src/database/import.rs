//! One-time import of the legacy JSON data files into the database.
//!
//! The JSON files are only ever read: they stay in place as a backup.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use std::fs;
use std::path::Path;
use tracing::info;

use super::store;
use super::{EventsDatabase, WebhooksDatabase};
use crate::config::Config;

const MARKER: &str = "json_import";

fn marker_set(conn: &Connection) -> Result<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM meta WHERE key = ?1", [MARKER], |_| Ok(()))
        .optional()?
        .is_some())
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).with_context(|| format!("Failed to read {path:?}"))?;
    let value = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse {path:?}; fix or move it and restart"))?;
    Ok(Some(value))
}

fn count(conn: &Connection, table: &str) -> Result<i64> {
    Ok(conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))?)
}

/// Import `config.json`, `webhooks.json` and `webhook_events.json` from
/// `data_dir` if the import has not happened yet and the database is empty.
///
/// Idempotent: once imported (or skipped because the database already had
/// data) a marker row stops any later import, so data deleted through the app
/// is never resurrected. A file that fails to parse aborts the whole import
/// with nothing written, so it can be retried after fixing the file.
pub fn run_if_needed(conn: &mut Connection, data_dir: &Path) -> Result<()> {
    if marker_set(conn)? {
        return Ok(());
    }
    // IMMEDIATE: concurrent first starts queue here and the loser sees the marker.
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if marker_set(&tx)? {
        return Ok(());
    }

    let config_path = data_dir.join("config.json");
    let webhooks_path = data_dir.join("webhooks.json");
    let events_path = data_dir.join("webhook_events.json");
    if !(config_path.exists() || webhooks_path.exists() || events_path.exists()) {
        return Ok(());
    }

    let empty = count(&tx, "app_config")? == 0
        && count(&tx, "webhooks")? == 0
        && count(&tx, "webhook_events")? == 0;
    if !empty {
        tx.execute(
            "INSERT INTO meta (key, value) VALUES (?1, 'skipped: database was not empty')",
            [MARKER],
        )?;
        tx.commit()?;
        info!("Legacy JSON files found but pxls.db already has data; not importing");
        return Ok(());
    }

    let mut imported = Vec::new();
    if let Some(config) = read_json::<Config>(&config_path)? {
        store::save_config(&tx, &config)?;
        imported.push("config.json");
    }
    if let Some(db) = read_json::<WebhooksDatabase>(&webhooks_path)? {
        store::replace_webhooks(&tx, &db.webhooks)?;
        imported.push("webhooks.json");
    }
    if let Some(db) = read_json::<EventsDatabase>(&events_path)? {
        store::replace_events(&tx, &db.events)?;
        imported.push("webhook_events.json");
    }
    tx.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)",
        rusqlite::params![
            MARKER,
            format!(
                "imported {} at {}",
                imported.join(", "),
                chrono::Utc::now().to_rfc3339()
            )
        ],
    )?;
    tx.commit()?;
    info!(
        "Imported {} into pxls.db. The JSON files were left in {:?} as a backup; pxls no longer reads them",
        imported.join(", "),
        data_dir
    );
    Ok(())
}
