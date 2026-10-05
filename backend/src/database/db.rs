//! Opening the SQLite database: file, pragmas, migrations and JSON import.

use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

pub const DB_FILE: &str = "pxls.db";
static SETUP: Mutex<()> = Mutex::new(());
const BUSY_TIMEOUT: Duration = Duration::from_secs(10);

/// Open (creating if needed) `<data_dir>/pxls.db`, bring the schema up to date
/// and import legacy JSON files on first start. Each call returns its own
/// connection; SQLite (WAL plus busy timeout) serialises writers.
pub fn open(data_dir: &Path) -> Result<Connection> {
    std::fs::create_dir_all(data_dir).context("Failed to create data directory")?;
    let path = data_dir.join(DB_FILE);
    create_private_file(&path)?;

    let mut conn = Connection::open(&path).context("Failed to open pxls.db")?;
    // Set the timeout first so the pragmas below wait instead of failing when
    // another connection is starting up at the same time.
    conn.busy_timeout(BUSY_TIMEOUT)?;
    conn.pragma_update(None, "foreign_keys", true)?;

    // Setup (WAL switch, migrations, import) runs one connection at a time per
    // process. SQLite does not retry a journal-mode switch that races another
    // connection opening the same fresh file ("lock protocol" errors), so the
    // busy timeout alone is not enough on the very first start.
    let _setup = SETUP.lock().unwrap_or_else(|e| e.into_inner());
    let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0))?;
    if !mode.eq_ignore_ascii_case("wal") {
        let mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
        anyhow::ensure!(
            mode.eq_ignore_ascii_case("wal"),
            "could not enable WAL mode (got {mode})"
        );
    }
    conn.pragma_update(None, "synchronous", "NORMAL")?;

    super::migrations::run(&mut conn, super::migrations::MIGRATIONS)?;
    super::import::run_if_needed(&mut conn, data_dir)?;
    Ok(conn)
}

/// The database holds credentials, so create it owner-only (like config.json was).
/// SQLite gives the -wal and -shm files the same mode.
fn create_private_file(path: &Path) -> Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
    {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(e).context("Failed to create pxls.db"),
    }
}

/// Run blocking database work without stalling the async executor.
///
/// The database API is synchronous, so callers in async handlers go through
/// this: on a multi-threaded runtime the worker hands its queued tasks to
/// other threads while the query runs. On other runtimes (single-threaded
/// tests) or outside one it simply runs inline.
pub fn off_executor<T>(f: impl FnOnce() -> T) -> T {
    use tokio::runtime::{Handle, RuntimeFlavor};
    match Handle::try_current() {
        Ok(h) if h.runtime_flavor() == RuntimeFlavor::MultiThread => tokio::task::block_in_place(f),
        _ => f(),
    }
}
