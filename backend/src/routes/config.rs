use axum::{
    extract::State,
    Json,
    response::Response,
    http::{StatusCode, header},
};
use serde::Deserialize;
use serde_json::json;
use tracing::{info, instrument};

use crate::AppState;
use crate::config::Config;

#[derive(Deserialize)]
pub struct ConfigUpdate {
    pub pixoo_mac: String,
    pub openweather_api_key: String,
    pub latitude: f64,
    pub longitude: f64,
}

/// Config as sent to the browser: secrets are removed, and the UI is told
/// whether a password is stored instead.
fn public_config_value(cfg: &Config) -> serde_json::Value {
    let mut value = serde_json::to_value(cfg).unwrap_or_default();
    if let Some(obj) = value.as_object_mut() {
        // The legacy pasted token is never needed by the UI.
        obj.remove("beszel_token");
        if let Some(auth) = obj.get_mut("beszel_auth").and_then(|a| a.as_object_mut()) {
            let password_set = cfg
                .beszel_auth
                .as_ref()
                .map_or(false, |a| !a.password.is_empty());
            auth.insert("password".into(), json!(""));
            auth.insert("password_set".into(), json!(password_set));
        }
    }
    value
}

#[instrument(skip(state))]
pub async fn get_config(State(state): State<AppState>) -> Response {
    match state.config.lock() {
        Ok(cfg) => {
            let json = serde_json::to_string_pretty(&public_config_value(&cfg)).unwrap();
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(json.into())
                .unwrap()
        }
        Err(_) => {
            let error = json!({"error": "Failed to get config"});
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(error.to_string().into())
                .unwrap()
        }
    }
}

/// The browser never receives stored secrets, so a config coming back from it
/// has them blank or missing. Carry the stored values over, unless the
/// request explicitly changes them.
fn preserve_secrets(incoming: &mut Config, stored: &Config) {
    match incoming.beszel_auth.as_mut() {
        // Empty email is how the UI clears the login.
        Some(auth) if auth.email.trim().is_empty() => incoming.beszel_auth = None,
        Some(auth) => {
            auth.email = auth.email.trim().to_string();
            if auth.password.is_empty() {
                if let Some(old) = &stored.beszel_auth {
                    auth.password = old.password.clone();
                }
            }
        }
        // Older clients / stale tabs don't send the field at all.
        None => incoming.beszel_auth = stored.beszel_auth.clone(),
    }

    // A real login supersedes the legacy pasted token; otherwise keep it as a
    // fallback (the UI no longer sends it).
    let has_login = incoming
        .beszel_auth
        .as_ref()
        .map_or(false, |a| !a.password.is_empty());
    incoming.beszel_token = if has_login { None } else { stored.beszel_token.clone() };
}

#[instrument(skip(state, new_config))]
pub async fn update_config(
    State(state): State<AppState>,
    Json(mut new_config): Json<Config>,
) -> Response {
    let (result, auth_changed) = match state.config.lock() {
        Ok(mut cfg) => {
            preserve_secrets(&mut new_config, &cfg);
            let auth_changed = cfg.beszel_auth.as_ref().map(|a| (&a.email, &a.password))
                != new_config.beszel_auth.as_ref().map(|a| (&a.email, &a.password));
            *cfg = new_config.clone();
            (Ok(cfg.save()), auth_changed)
        }
        Err(_) => (Err(()), false),
    };

    // Outside the config lock: TokenManager takes its own lock first and the
    // config lock second, so taking them in the other order could deadlock.
    if auth_changed {
        state.token_manager.invalidate();
    }

    match result {
        Ok(save_result) => {
            match save_result {
                Ok(_) => {
                    let success = json!({"success": true, "config": public_config_value(&new_config)});
                    Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(success.to_string().into())
                        .unwrap()
                }
                Err(e) => {
                    let error = json!({"error": format!("Failed to save config: {}", e)});
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(error.to_string().into())
                        .unwrap()
                }
            }
        }
        Err(_) => {
            let error = json!({"error": "Failed to update config"});
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(error.to_string().into())
                .unwrap()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{BeszelAuthConfig, BeszelTokenConfig};

    fn auth(email: &str, password: &str) -> Option<BeszelAuthConfig> {
        Some(BeszelAuthConfig { email: email.into(), password: password.into() })
    }

    fn stored() -> Config {
        let mut c = Config::default();
        c.beszel_auth = auth("pixoo@example.com", "s3cret");
        c
    }

    #[test]
    fn blank_password_keeps_stored_one() {
        let mut incoming = Config::default();
        incoming.beszel_auth = auth("pixoo@example.com", "");
        preserve_secrets(&mut incoming, &stored());
        assert_eq!(incoming.beszel_auth.unwrap().password, "s3cret");
    }

    #[test]
    fn missing_field_from_stale_client_keeps_login() {
        let mut incoming = Config::default();
        incoming.beszel_auth = None;
        preserve_secrets(&mut incoming, &stored());
        assert_eq!(incoming.beszel_auth.unwrap().email, "pixoo@example.com");
    }

    #[test]
    fn new_password_replaces_stored_one() {
        let mut incoming = Config::default();
        incoming.beszel_auth = auth("pixoo@example.com", "new");
        preserve_secrets(&mut incoming, &stored());
        assert_eq!(incoming.beszel_auth.unwrap().password, "new");
    }

    #[test]
    fn empty_email_clears_login() {
        let mut incoming = Config::default();
        incoming.beszel_auth = auth("", "");
        preserve_secrets(&mut incoming, &stored());
        assert!(incoming.beszel_auth.is_none());
    }

    #[test]
    fn real_login_drops_legacy_token_but_otherwise_it_is_kept() {
        let mut old = Config::default();
        old.beszel_token = Some(BeszelTokenConfig { auth_token: "t".into(), last_refresh: None });

        let mut with_login = Config::default();
        with_login.beszel_auth = auth("a@b.c", "pw");
        preserve_secrets(&mut with_login, &old);
        assert!(with_login.beszel_token.is_none());

        let mut without_login = Config::default();
        preserve_secrets(&mut without_login, &old);
        assert!(without_login.beszel_token.is_some());
    }

    #[test]
    fn public_config_never_contains_secrets() {
        let mut c = stored();
        c.beszel_token = Some(BeszelTokenConfig { auth_token: "tok123".into(), last_refresh: None });
        let json = public_config_value(&c).to_string();
        assert!(!json.contains("s3cret"));
        assert!(!json.contains("tok123"));
        assert!(json.contains("\"password_set\":true"));
    }
}
