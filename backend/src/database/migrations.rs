//! Versioned schema migrations.
//!
//! Migrations are the `NNNN_name.sql` files in `src/database/migrations/`,
//! embedded at build time by `src/build.rs`. To change the schema, add a new
//! numbered file there; nothing else needs editing. Never edit a released one.
//!
//! Each pending migration runs in its own transaction and is recorded in
//! `schema_version`. Migrations are matched by version number, not by "highest
//! applied", so one that lands via a merge with a lower number than an already
//! applied one still runs.

use anyhow::{bail, Context, Result};
use rusqlite::{Connection, TransactionBehavior};
use std::collections::HashSet;
use tracing::info;

pub struct Migration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

include!(concat!(env!("OUT_DIR"), "/migrations_list.rs"));

fn applied_versions(conn: &Connection) -> Result<HashSet<u32>> {
    let mut stmt = conn.prepare("SELECT version FROM schema_version")?;
    let rows = stmt.query_map([], |r| r.get::<_, u32>(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Apply every migration in `migrations` that has not been applied yet.
pub fn run(conn: &mut Connection, migrations: &[Migration]) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version    INTEGER PRIMARY KEY NOT NULL,
            name       TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )",
    )
    .context("Failed to create schema_version table")?;

    let known: HashSet<u32> = migrations.iter().map(|m| m.version).collect();
    let applied = applied_versions(conn)?;
    if let Some(unknown) = applied.iter().find(|v| !known.contains(v)) {
        bail!(
            "pxls.db has schema version {unknown} which this build does not know; it was created by a newer pxls. Upgrade pxls or restore an older backup"
        );
    }
    if migrations.iter().all(|m| applied.contains(&m.version)) {
        return Ok(());
    }

    let mut ordered: Vec<&Migration> = migrations.iter().collect();
    ordered.sort_by_key(|m| m.version);
    for m in ordered {
        // IMMEDIATE takes the write lock up front so concurrent starters queue
        // here instead of both applying the same migration.
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let done: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_version WHERE version = ?1)",
            [m.version],
            |r| r.get(0),
        )?;
        if done {
            continue;
        }
        tx.execute_batch(m.sql)
            .with_context(|| format!("Migration {:04}_{} failed", m.version, m.name))?;
        tx.execute(
            "INSERT INTO schema_version (version, name) VALUES (?1, ?2)",
            rusqlite::params![m.version, m.name],
        )?;
        tx.commit()?;
        info!("Applied database migration {:04}_{}", m.version, m.name);
    }
    Ok(())
}
