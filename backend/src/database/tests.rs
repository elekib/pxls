use super::*;
use crate::webhook_enhanced::WebhookEvent;
use chrono::TimeZone;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use super::migrations::{self, Migration};

/// Unique temp data dir, removed on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        let dir =
            std::env::temp_dir().join(format!("pxls-db-test-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }
    fn path(&self) -> &Path {
        &self.0
    }
    fn s(&self) -> &str {
        self.0.to_str().unwrap()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn mem() -> Connection {
    Connection::open_in_memory().unwrap()
}

fn webhook_json(name: &str, path: &str, secret: &str) -> Value {
    json!({
        "name": name, "enabled": true, "path": path, "secret": secret,
        "log_events": true, "max_events": 25,
        "rules": [{
            "id": "rule-1", "name": "Movie added", "enabled": true, "priority": 1,
            "conditions": [{"field_path": "eventType", "operator": "equals", "value": "Download"}],
            "actions": []
        }],
        "default_actions": [],
        "display_on_no_match": false,
        "duration_secs": 8, "display_mode": "icon_with_text",
        "background_color": "102030", "text_color": "FFEEDD",
        "title_field": "movie.title", "subtitle_field": "movie.year",
        "flash": true, "flash_speed_ms": 250,
        "icon": "film", "icon_image_url": "https://example.test/icon.png",
        "image_url_field": "movie.poster"
    })
}

fn event_json(id: &str, webhook: &str, secs: i64) -> Value {
    let ts = chrono::Utc
        .timestamp_opt(1_700_000_000 + secs, 123_456_789)
        .unwrap();
    json!({
        "id": id, "webhook_name": webhook, "timestamp": ts,
        "payload": {"title": format!("Title {id}"), "nested": {"n": [1, 2, 3]}},
        "processed": true, "actions_taken": ["display", "flash"],
        "error": null, "matched_rule": "Movie added"
    })
}

fn event(id: &str, webhook: &str, secs: i64) -> WebhookEvent {
    serde_json::from_value(event_json(id, webhook, secs)).unwrap()
}

/// Realistic, entirely made-up legacy files.
fn write_fixtures(dir: &Path) -> (String, String, String) {
    let config = json!({
        "pixoo_mac": "AA:BB:CC:DD:EE:FF",
        "weather_location": "Springfield,XX",
        "timezone": "Europe/Berlin",
        "refresh_interval_ms": 1500,
        "rotation_time_secs": 30,
        "clock_color": "00FF00", "date_color": "FF00FF", "weather_color": "0000FF",
        "custom_pages": [
            {"name": "Clock", "enabled": true, "page_type": {"type": "ClockWeather",
                "clock_color": "00FF00", "date_color": "FF00FF", "weather_color": "0000FF",
                "weather_location": "Springfield,XX", "temperature_unit": "celsius"}},
            {"name": "Stats", "enabled": false, "page_type": {"type": "SystemStats",
                "source": "beszel", "dashdot_url": null,
                "beszel_hub_url": "http://hub.example.test", "beszel_system_id": "sys1",
                "brand_text": "NAS", "brand_color": "FFFFFF"}}
        ],
        "webhooks": [],
        "enhanced_webhooks": [],
        "beszel_auth": {"email": "dash@example.test", "password": "fixture-password-123"}
    });
    let webhooks = json!({"webhooks": [
        webhook_json("radarr", "radarr", "fixture-secret-radarr-0000"),
        webhook_json("sonarr", "sonarr", "fixture-secret-sonarr-1111"),
    ]});
    let events = json!({"events": [
        event_json("e1", "radarr", 1), event_json("e2", "sonarr", 2),
        event_json("e3", "radarr", 3), event_json("e4", "radarr", 4),
    ]});
    let (c, w, e) = (config.to_string(), webhooks.to_string(), events.to_string());
    fs::write(dir.join("config.json"), &c).unwrap();
    fs::write(dir.join("webhooks.json"), &w).unwrap();
    fs::write(dir.join("webhook_events.json"), &e).unwrap();
    (c, w, e)
}

fn as_value<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

// ---- migrations ---------------------------------------------------------

#[test]
fn embedded_migrations_are_numbered_and_unique() {
    let versions: Vec<u32> = migrations::MIGRATIONS.iter().map(|m| m.version).collect();
    assert!(!versions.is_empty());
    assert_eq!(versions[0], 1);
    let mut sorted = versions.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted, versions, "versions must be unique and ascending");
}

#[test]
fn migrations_apply_once_and_are_recorded() {
    let mut conn = mem();
    migrations::run(&mut conn, migrations::MIGRATIONS).unwrap();
    migrations::run(&mut conn, migrations::MIGRATIONS).unwrap();
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n as usize, migrations::MIGRATIONS.len());
    for table in ["meta", "app_config", "webhooks", "webhook_events"] {
        conn.prepare(&format!("SELECT * FROM {table}")).unwrap();
    }
}

#[test]
fn later_migrations_apply_on_top_of_existing_database() {
    let mut conn = mem();
    let v1 = Migration {
        version: 1,
        name: "a",
        sql: "CREATE TABLE a (x)",
    };
    migrations::run(&mut conn, &[Migration { ..v1 }]).unwrap();
    let v2 = Migration {
        version: 2,
        name: "b",
        sql: "CREATE TABLE b (y)",
    };
    migrations::run(&mut conn, &[Migration { ..v1 }, v2]).unwrap();
    conn.prepare("SELECT y FROM b").unwrap();
}

#[test]
fn lower_numbered_migration_added_later_still_runs() {
    let mut conn = mem();
    let m1 = || Migration {
        version: 1,
        name: "a",
        sql: "CREATE TABLE a (x)",
    };
    let m3 = || Migration {
        version: 3,
        name: "c",
        sql: "CREATE TABLE c (z)",
    };
    migrations::run(&mut conn, &[m1(), m3()]).unwrap();
    let m2 = Migration {
        version: 2,
        name: "b",
        sql: "CREATE TABLE b (y)",
    };
    migrations::run(&mut conn, &[m1(), m2, m3()]).unwrap();
    conn.prepare("SELECT y FROM b").unwrap();
}

#[test]
fn failed_migration_rolls_back_and_is_not_recorded() {
    let mut conn = mem();
    let bad = Migration {
        version: 1,
        name: "bad",
        sql: "CREATE TABLE half (x); INSERT INTO missing_table VALUES (1);",
    };
    assert!(migrations::run(&mut conn, &[bad]).is_err());
    assert!(conn.prepare("SELECT x FROM half").is_err());
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 0);
}

#[test]
fn database_from_newer_build_is_refused() {
    let mut conn = mem();
    let m = |v, sql| Migration {
        version: v,
        name: "m",
        sql,
    };
    migrations::run(
        &mut conn,
        &[m(1, "CREATE TABLE a (x)"), m(2, "CREATE TABLE b (x)")],
    )
    .unwrap();
    let err = migrations::run(&mut conn, &[m(1, "CREATE TABLE a (x)")]).unwrap_err();
    assert!(err.to_string().contains("newer pxls"), "{err}");
}

#[test]
fn open_sets_pragmas_and_private_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let dir = TempDir::new();
    let conn = db::open(dir.path()).unwrap();
    let mode: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(mode, "wal");
    let fk: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fk, 1);
    let busy: i64 = conn
        .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
        .unwrap();
    assert!(busy >= 1000);
    let perms = fs::metadata(dir.path().join("pxls.db"))
        .unwrap()
        .permissions();
    assert_eq!(perms.mode() & 0o777, 0o600);
}

// ---- import -------------------------------------------------------------

#[test]
fn imports_json_files_once_and_leaves_them_untouched() {
    let dir = TempDir::new();
    let (c, w, e) = write_fixtures(dir.path());

    let cfg = Config::load_from(dir.s()).unwrap();
    assert_eq!(cfg.pixoo_mac, "AA:BB:CC:DD:EE:FF");
    assert_eq!(cfg.timezone, "Europe/Berlin");
    assert_eq!(cfg.custom_pages.len(), 2);
    assert_eq!(
        cfg.beszel_auth.as_ref().unwrap().password,
        "fixture-password-123"
    );

    let wdb = WebhookDatabase::new(dir.s());
    let hooks = wdb.load_webhooks().unwrap().webhooks;
    assert_eq!(
        hooks.iter().map(|h| h.name.as_str()).collect::<Vec<_>>(),
        ["radarr", "sonarr"]
    );
    assert_eq!(hooks[0].secret.0, "fixture-secret-radarr-0000");
    assert_eq!(hooks[0].rules.len(), 1);
    assert_eq!(hooks[0].max_events, 25);
    assert!(!hooks[0].display_on_no_match);

    let events = wdb.load_events().unwrap().events;
    assert_eq!(
        events.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
        ["e1", "e2", "e3", "e4"]
    );
    assert_eq!(events[0].timestamp.timestamp_subsec_nanos(), 123_456_789);

    // The JSON files are byte-for-byte unchanged and no temp files were left.
    assert_eq!(
        fs::read_to_string(dir.path().join("config.json")).unwrap(),
        c
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("webhooks.json")).unwrap(),
        w
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("webhook_events.json")).unwrap(),
        e
    );
    assert!(!dir.path().join("config.json.tmp").exists());
}

#[test]
fn imported_data_equals_what_the_old_code_would_load() {
    let dir = TempDir::new();
    write_fixtures(dir.path());
    let from_file: Config =
        serde_json::from_str(&fs::read_to_string(dir.path().join("config.json")).unwrap()).unwrap();
    let from_db = Config::load_from(dir.s()).unwrap();
    assert_eq!(as_value(&from_file), as_value(&from_db));

    let file_hooks: WebhooksDatabase =
        serde_json::from_str(&fs::read_to_string(dir.path().join("webhooks.json")).unwrap())
            .unwrap();
    let db_hooks = WebhookDatabase::new(dir.s()).load_webhooks().unwrap();
    assert_eq!(as_value(&file_hooks), as_value(&db_hooks));
}

#[test]
fn import_is_idempotent_and_never_resurrects_deleted_data() {
    let dir = TempDir::new();
    write_fixtures(dir.path());
    let wdb = WebhookDatabase::new(dir.s());
    assert_eq!(wdb.load_webhooks().unwrap().webhooks.len(), 2);

    wdb.save_webhooks(&WebhooksDatabase { webhooks: vec![] })
        .unwrap();
    wdb.clear_events(None).unwrap();
    // Reopening runs the import check again; the JSON files must not come back.
    assert!(wdb.load_webhooks().unwrap().webhooks.is_empty());
    assert!(wdb.load_events().unwrap().events.is_empty());

    let conn = db::open(dir.path()).unwrap();
    let rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM meta WHERE key = 'json_import'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rows, 1);
}

#[test]
fn import_is_skipped_when_database_already_has_data() {
    let dir = TempDir::new();
    let cfg = Config {
        pixoo_mac: "11:22:33:44:55:66".into(),
        ..Config::default()
    };
    cfg.save_to(dir.s()).unwrap();

    write_fixtures(dir.path());
    let loaded = Config::load_from(dir.s()).unwrap();
    assert_eq!(loaded.pixoo_mac, "11:22:33:44:55:66");
    assert!(WebhookDatabase::new(dir.s())
        .load_webhooks()
        .unwrap()
        .webhooks
        .is_empty());
}

#[test]
fn partial_json_sets_import_only_what_exists() {
    let dir = TempDir::new();
    fs::write(
        dir.path().join("webhooks.json"),
        json!({"webhooks": [webhook_json("only", "only", "fixture-secret-only-2222")]}).to_string(),
    )
    .unwrap();
    let wdb = WebhookDatabase::new(dir.s());
    assert_eq!(wdb.load_webhooks().unwrap().webhooks.len(), 1);
    // No config.json: first load writes defaults.
    assert_eq!(
        Config::load_from(dir.s()).unwrap().timezone,
        Config::default().timezone
    );
}

#[test]
fn malformed_json_aborts_import_with_nothing_written_then_retries() {
    let dir = TempDir::new();
    write_fixtures(dir.path());
    fs::write(dir.path().join("webhook_events.json"), "{ not json").unwrap();

    let err = db::open(dir.path()).unwrap_err();
    assert!(
        format!("{err:#}").contains("webhook_events.json"),
        "{err:#}"
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("webhook_events.json")).unwrap(),
        "{ not json"
    );

    // Fix the file; the import succeeds and includes everything.
    fs::write(
        dir.path().join("webhook_events.json"),
        json!({"events": []}).to_string(),
    )
    .unwrap();
    assert_eq!(
        WebhookDatabase::new(dir.s())
            .load_webhooks()
            .unwrap()
            .webhooks
            .len(),
        2
    );
    assert_eq!(
        Config::load_from(dir.s()).unwrap().pixoo_mac,
        "AA:BB:CC:DD:EE:FF"
    );
}

#[test]
fn concurrent_first_start_imports_exactly_once() {
    let dir = TempDir::new();
    write_fixtures(dir.path());
    let path = Arc::new(dir.s().to_string());
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let path = path.clone();
            thread::spawn(move || {
                let w = WebhookDatabase::new(&path);
                (
                    w.load_webhooks().unwrap().webhooks.len(),
                    w.load_events().unwrap().events.len(),
                )
            })
        })
        .collect();
    for h in handles {
        assert_eq!(h.join().unwrap(), (2, 4));
    }
}

// ---- round trips --------------------------------------------------------

#[test]
fn config_defaults_written_on_first_run_and_round_trip() {
    let dir = TempDir::new();
    let first = Config::load_from(dir.s()).unwrap();
    let second = Config::load_from(dir.s()).unwrap();
    assert_eq!(as_value(&first), as_value(&Config::default()));
    assert_eq!(as_value(&first), as_value(&second));
    assert!(
        !dir.path().join("config.json").exists(),
        "no JSON files are written any more"
    );
}

#[test]
fn config_save_and_load_round_trip_with_secrets() {
    let dir = TempDir::new();
    let mut cfg = Config {
        beszel_auth: Some(crate::config::BeszelAuthConfig {
            email: "a@example.test".into(),
            password: "fixture-pw-xyz".into(),
        }),
        rotation_time_secs: 99,
        ..Config::default()
    };
    cfg.save_to(dir.s()).unwrap();
    let back = Config::load_from(dir.s()).unwrap();
    assert_eq!(as_value(&cfg), as_value(&back));
    // Debug redaction is unchanged for loaded configs.
    assert!(!format!("{back:?}").contains("fixture-pw-xyz"));
    // Overwriting keeps a single row.
    cfg.rotation_time_secs = 5;
    cfg.save_to(dir.s()).unwrap();
    assert_eq!(Config::load_from(dir.s()).unwrap().rotation_time_secs, 5);
}

#[test]
fn legacy_config_webhooks_are_migrated_into_the_table() {
    let dir = TempDir::new();
    let mut cfg = Config::default();
    cfg.webhooks.push(crate::config::WebhookConfig {
        name: "old".into(),
        path: "old".into(),
        enabled: true,
        ..Default::default()
    });
    cfg.save_to(dir.s()).unwrap();
    Config::load_from(dir.s()).unwrap();
    let hooks = WebhookDatabase::new(dir.s())
        .load_webhooks()
        .unwrap()
        .webhooks;
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks[0].name, "old");
    assert!(hooks[0].secret.0.len() >= 32);
}

#[test]
fn webhooks_round_trip_keeping_order_and_all_fields() {
    let dir = TempDir::new();
    let wdb = WebhookDatabase::new(dir.s());
    let input: WebhooksDatabase = serde_json::from_value(json!({"webhooks": [
        webhook_json("zeta", "z", "fixture-secret-z-aaaaaaaa"),
        webhook_json("alpha", "a", "fixture-secret-a-bbbbbbbb"),
    ]}))
    .unwrap();
    wdb.save_webhooks(&input).unwrap();
    let out = wdb.load_webhooks().unwrap();
    assert_eq!(as_value(&input), as_value(&out));
    assert_eq!(out.webhooks[0].name, "zeta");
    // Replacing shrinks the set.
    wdb.save_webhooks(&WebhooksDatabase {
        webhooks: vec![input.webhooks[1].clone()],
    })
    .unwrap();
    assert_eq!(wdb.load_webhooks().unwrap().webhooks.len(), 1);
}

#[test]
fn webhook_secret_is_a_column_and_not_duplicated_in_the_json() {
    let dir = TempDir::new();
    let wdb = WebhookDatabase::new(dir.s());
    wdb.save_webhooks(
        &serde_json::from_value(json!({"webhooks": [
        webhook_json("one", "one", "fixture-secret-column-77")]}))
        .unwrap(),
    )
    .unwrap();
    let conn = db::open(dir.path()).unwrap();
    let (secret, cfg): (String, String) = conn
        .query_row("SELECT secret, config FROM webhooks", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(secret, "fixture-secret-column-77");
    assert!(!cfg.contains("fixture-secret-column-77"));
}

#[test]
fn events_round_trip_and_query() {
    let dir = TempDir::new();
    let wdb = WebhookDatabase::new(dir.s());
    for (i, name) in ["a", "b", "a", "a"].iter().enumerate() {
        wdb.log_event(event(&format!("e{i}"), name, i as i64), 100)
            .unwrap();
    }
    let all = wdb.load_events().unwrap().events;
    assert_eq!(
        all.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
        ["e0", "e1", "e2", "e3"]
    );
    assert_eq!(as_value(&all[0]), event_json("e0", "a", 0));

    let newest = wdb.get_events(None, Some(2)).unwrap();
    assert_eq!(
        newest.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
        ["e3", "e2"]
    );
    let only_a = wdb.get_events(Some("a".into()), None).unwrap();
    assert_eq!(
        only_a.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
        ["e3", "e2", "e0"]
    );
    assert!(wdb
        .get_events(Some("nope".into()), None)
        .unwrap()
        .is_empty());

    wdb.clear_events(Some("a".into())).unwrap();
    assert_eq!(wdb.load_events().unwrap().events.len(), 1);
    wdb.clear_events(None).unwrap();
    assert!(wdb.load_events().unwrap().events.is_empty());
}

#[test]
fn ensure_secrets_fills_only_empty_ones() {
    let dir = TempDir::new();
    let wdb = WebhookDatabase::new(dir.s());
    wdb.save_webhooks(
        &serde_json::from_value(json!({"webhooks": [
            webhook_json("keep", "keep", "fixture-secret-keep-9999"),
            webhook_json("empty", "empty", ""),
        ]}))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(wdb.ensure_secrets().unwrap(), 1);
    assert_eq!(wdb.ensure_secrets().unwrap(), 0);
    let hooks = wdb.load_webhooks().unwrap().webhooks;
    assert_eq!(hooks[0].secret.0, "fixture-secret-keep-9999");
    assert!(hooks[1].secret.0.len() >= 32);
}

// ---- trimming -----------------------------------------------------------

#[test]
fn log_event_trims_per_webhook_keeping_newest() {
    let dir = TempDir::new();
    let wdb = WebhookDatabase::new(dir.s());
    for i in 0..5 {
        wdb.log_event(event(&format!("a{i}"), "a", i), 3).unwrap();
        wdb.log_event(event(&format!("b{i}"), "b", i), 10).unwrap();
    }
    let a: Vec<String> = wdb
        .get_events(Some("a".into()), None)
        .unwrap()
        .into_iter()
        .map(|e| e.id)
        .collect();
    assert_eq!(a, ["a4", "a3", "a2"]);
    assert_eq!(wdb.get_events(Some("b".into()), None).unwrap().len(), 5);
}

#[test]
fn zero_cap_drops_the_new_event_too_like_before() {
    let dir = TempDir::new();
    let wdb = WebhookDatabase::new(dir.s());
    wdb.log_event(event("x", "a", 0), 0).unwrap();
    assert!(wdb.load_events().unwrap().events.is_empty());
}

#[test]
fn log_event_enforces_global_cap_of_1000() {
    let dir = TempDir::new();
    let wdb = WebhookDatabase::new(dir.s());
    let seed: Vec<WebhookEvent> = (0..1000).map(|i| event(&format!("s{i}"), "a", i)).collect();
    wdb.save_events(&EventsDatabase { events: seed }).unwrap();
    for i in 0..5 {
        wdb.log_event(event(&format!("n{i}"), "b", 2000 + i), 5000)
            .unwrap();
    }
    let all = wdb.load_events().unwrap().events;
    assert_eq!(all.len(), 1000);
    assert_eq!(all[0].id, "s5");
    assert_eq!(all[999].id, "n4");
}

// ---- concurrency --------------------------------------------------------

#[test]
fn concurrent_writers_and_readers_do_not_lose_or_fail() {
    let dir = TempDir::new();
    let path = Arc::new(dir.s().to_string());
    // Create the database up front so every thread sees an existing schema.
    WebhookDatabase::new(&path).load_events().unwrap();

    let mut handles = Vec::new();
    for t in 0..6 {
        let path = path.clone();
        handles.push(thread::spawn(move || {
            let wdb = WebhookDatabase::new(&path);
            for i in 0..20 {
                wdb.log_event(event(&format!("t{t}-{i}"), &format!("hook{t}"), i), 1000)
                    .unwrap();
                wdb.get_events(None, Some(5)).unwrap();
            }
        }));
    }
    for t in 0..2 {
        let path = path.clone();
        handles.push(thread::spawn(move || {
            for i in 0..20 {
                let cfg = Config {
                    rotation_time_secs: t * 100 + i,
                    ..Config::default()
                };
                cfg.save_to(&path).unwrap();
                Config::load_from(&path).unwrap();
            }
        }));
    }
    for h in handles {
        h.join().unwrap();
    }
    let wdb = WebhookDatabase::new(&path);
    assert_eq!(wdb.load_events().unwrap().events.len(), 120);
    for t in 0..6 {
        assert_eq!(
            wdb.get_events(Some(format!("hook{t}")), None)
                .unwrap()
                .len(),
            20
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn works_from_async_handlers_on_a_multi_thread_runtime() {
    let dir = TempDir::new();
    let wdb = Arc::new(WebhookDatabase::new(dir.s()));
    let tasks: Vec<_> = (0..8)
        .map(|i| {
            let wdb = wdb.clone();
            tokio::spawn(
                async move { wdb.log_event(event(&format!("x{i}"), "a", i), 100).unwrap() },
            )
        })
        .collect();
    for t in tasks {
        t.await.unwrap();
    }
    assert_eq!(wdb.load_events().unwrap().events.len(), 8);
}

#[tokio::test]
async fn works_on_a_current_thread_runtime() {
    let dir = TempDir::new();
    let wdb = WebhookDatabase::new(dir.s());
    wdb.log_event(event("only", "a", 0), 10).unwrap();
    assert_eq!(wdb.get_events(None, None).unwrap().len(), 1);
}
