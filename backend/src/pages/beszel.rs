//! Beszel hub lookups shared by the System, GPU and Temps pages.
//!
//! Pages re-render about twice a second, and each render needs the Beszel
//! system ID for its configured name. Names almost never change, so the
//! resolved IDs are cached and the hub is only asked once in a while.

use crate::token_manager::TokenManager;
use anyhow::Result;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tracing::debug;

/// How long a resolved system ID is trusted. A deleted or re-added system is
/// picked up sooner than this when the hub answers 404 for it (see `note_failure`).
const CACHE_TTL: Duration = Duration::from_secs(600);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Deserialize, Debug, Default)]
struct SystemRecord {
    id: String,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct ListResponse {
    #[serde(default)]
    items: Vec<SystemRecord>,
}

struct Entry {
    id: String,
    at: Instant,
}

fn cache() -> &'static Mutex<HashMap<String, Entry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// `None` means "the first system on the hub".
fn cache_key(hub_url: &str, name: Option<&str>) -> String {
    format!(
        "{}|{}",
        hub_url.trim_end_matches('/'),
        name.map(|n| n.trim().to_lowercase())
            .unwrap_or_else(|| "*".to_string())
    )
}

fn is_fresh(entry: &Entry) -> bool {
    entry.at.elapsed() < CACHE_TTL
}

fn cached(key: &str) -> Option<String> {
    let map = cache().lock().ok()?;
    map.get(key).filter(|e| is_fresh(e)).map(|e| e.id.clone())
}

fn store(key: String, id: &str) {
    if let Ok(mut map) = cache().lock() {
        map.insert(
            key,
            Entry {
                id: id.to_string(),
                at: Instant::now(),
            },
        );
    }
}

/// Drop the cached ID for a system, so the next render looks it up again.
pub fn forget_system(hub_url: &str, name: Option<&str>) {
    if let Ok(mut map) = cache().lock() {
        map.remove(&cache_key(hub_url, name));
    }
}

/// Call when a request for a resolved system failed: a 404 means the cached ID
/// is stale (system removed or re-created on the hub).
pub fn note_failure(hub_url: &str, requested: Option<&str>, err: &ureq::Error) {
    if matches!(err, ureq::Error::Status(404, _)) {
        debug!("Hub returned 404 for a system, dropping its cached ID");
        forget_system(hub_url, requested);
    }
}

/// Resolve a Beszel system ID from its name, or the first system if `name` is
/// `None`. Cached; on a miss it asks the hub, logging in again once if needed.
pub fn resolve_system_id(
    hub_url: &str,
    name: Option<&str>,
    token_manager: Option<&Arc<TokenManager>>,
) -> Option<String> {
    let key = cache_key(hub_url, name);
    if let Some(id) = cached(&key) {
        return Some(id);
    }

    let token = token_manager.and_then(|tm| tm.get_token());
    let found = match lookup(hub_url, name, token.as_deref()) {
        Ok(id) => Some(id),
        Err(e) => {
            debug!(error = %e, ?name, "System lookup failed, logging in again and retrying");
            token_manager
                .and_then(|tm| tm.refresh_token())
                .and_then(|t| lookup(hub_url, name, Some(&t)).ok())
        }
    };

    if let Some(id) = &found {
        store(key, id);
    }
    found
}

fn lookup(hub_url: &str, name: Option<&str>, token: Option<&str>) -> Result<String> {
    let base = hub_url.trim_end_matches('/');
    let url = match name {
        Some(n) => format!(
            "{}/api/collections/systems/records?filter=name%3D%27{}%27",
            base,
            urlencoding::encode(n)
        ),
        None => format!("{base}/api/collections/systems/records?perPage=1"),
    };

    let mut req = ureq::get(&url).timeout(REQUEST_TIMEOUT);
    if let Some(token) = token {
        req = req.set("Authorization", &format!("Bearer {token}"));
    }
    let body = req.call()?.into_string().unwrap_or_default();
    let data: ListResponse =
        serde_json::from_str(&body).map_err(|e| anyhow::anyhow!("Parse error: {e}"))?;
    pick_system(&data.items, name)
}

/// Exact name match first, then case-insensitive. With no name, the first one.
fn pick_system(items: &[SystemRecord], name: Option<&str>) -> Result<String> {
    let Some(name) = name else {
        return items
            .first()
            .map(|s| s.id.clone())
            .ok_or_else(|| anyhow::anyhow!("No systems found"));
    };

    items
        .iter()
        .find(|s| s.name.as_deref() == Some(name))
        .or_else(|| {
            let lower = name.to_lowercase();
            items
                .iter()
                .find(|s| s.name.as_deref().map(|n| n.to_lowercase()).as_deref() == Some(&lower))
        })
        .map(|s| s.id.clone())
        .ok_or_else(|| anyhow::anyhow!("System '{name}' not found"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sys(id: &str, name: &str) -> SystemRecord {
        SystemRecord {
            id: id.into(),
            name: Some(name.into()),
        }
    }

    #[test]
    fn cache_key_ignores_case_and_trailing_slash() {
        assert_eq!(
            cache_key("http://hub:8090/", Some(" Stark ")),
            cache_key("http://hub:8090", Some("stark"))
        );
        assert_ne!(
            cache_key("http://hub:8090", Some("a")),
            cache_key("http://hub:8090", None)
        );
    }

    #[test]
    fn entries_expire() {
        let fresh = Entry {
            id: "x".into(),
            at: Instant::now(),
        };
        assert!(is_fresh(&fresh));
        let old = Entry {
            id: "x".into(),
            at: Instant::now()
                .checked_sub(CACHE_TTL + Duration::from_secs(1))
                .unwrap(),
        };
        assert!(!is_fresh(&old));
    }

    #[test]
    fn cache_roundtrip_and_forget() {
        let key = cache_key("http://test-hub", Some("Roundtrip"));
        assert_eq!(cached(&key), None);
        store(key.clone(), "abc");
        assert_eq!(cached(&key).as_deref(), Some("abc"));
        forget_system("http://test-hub", Some("roundtrip"));
        assert_eq!(cached(&key), None);
    }

    #[test]
    fn picks_exact_then_case_insensitive() {
        let items = vec![sys("1", "STARK"), sys("2", "Stark")];
        assert_eq!(pick_system(&items, Some("Stark")).unwrap(), "2");
        assert_eq!(pick_system(&items, Some("stark")).unwrap(), "1");
        assert!(pick_system(&items, Some("missing")).is_err());
    }

    #[test]
    fn no_name_picks_first() {
        assert_eq!(
            pick_system(&[sys("1", "a"), sys("2", "b")], None).unwrap(),
            "1"
        );
        assert!(pick_system(&[], None).is_err());
    }
}
