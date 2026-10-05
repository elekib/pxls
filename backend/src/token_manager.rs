use crate::config::{Config, PageType};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tracing::{debug, info, warn};

/// Log in again this long before the token's `exp` claim.
const RENEW_BEFORE_EXPIRY_SECS: i64 = 3600;
/// Minimum gap between login attempts. Every render of a Beszel page can ask for
/// a token, so without this a bad password or a down hub would hammer the hub
/// (and could trip PocketBase's rate limiting).
const MIN_LOGIN_INTERVAL: Duration = Duration::from_secs(30);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5);
/// Pages call `refresh_token` after any failed lookup, not only after a 401.
/// A token this fresh is not the problem, so don't log in again for it.
const MIN_TOKEN_AGE_FOR_FORCED_RELOGIN: Duration = Duration::from_secs(300);

#[derive(Debug, Deserialize)]
struct AuthResponse {
    token: String,
}

#[derive(Debug, Deserialize)]
struct JwtClaims {
    exp: i64,
}

#[derive(Debug, Serialize)]
pub struct AuthStatus {
    /// Credentials are configured (or a legacy token is present).
    pub configured: bool,
    /// "credentials", "legacy_token" or "none".
    pub mode: &'static str,
    /// A usable token is currently held.
    pub logged_in: bool,
    /// Unix timestamp the current token expires at, if known.
    pub token_expires: Option<i64>,
    /// Message from the most recent failed login, cleared on success.
    pub last_error: Option<String>,
}

#[derive(Default)]
struct AuthState {
    token: Option<String>,
    exp: Option<i64>,
    logged_in_at: Option<Instant>,
    last_attempt: Option<Instant>,
    last_error: Option<String>,
}

/// Provides a valid Beszel (PocketBase) auth token.
///
/// With credentials configured it logs in itself, keeps the token in memory
/// only, and logs in again before expiry or on demand after a 401. The pasted
/// token from older versions is used only while no credentials are set.
pub struct TokenManager {
    config: Arc<Mutex<Config>>,
    state: Mutex<AuthState>,
}

impl TokenManager {
    pub fn new(config: Arc<Mutex<Config>>) -> Self {
        Self {
            config,
            state: Mutex::new(AuthState::default()),
        }
    }

    /// Current token, logging in first if there is none or it is about to expire.
    pub fn get_token(&self) -> Option<String> {
        let mut state = self.state.lock().unwrap();

        if let Some(token) = &state.token {
            if !Self::needs_renewal(state.exp) {
                return Some(token.clone());
            }
        }

        match self.credentials() {
            Some((email, password)) => {
                if Self::throttled(&state) {
                    // Still usable if not actually expired yet.
                    return Self::unexpired_token(&state);
                }
                self.login_locked(&mut state, &email, &password)
            }
            None => self.legacy_token(),
        }
    }

    /// Called by pages after a failed request (usually a 401): drop the token
    /// and log in again, subject to the retry throttle.
    pub fn refresh_token(&self) -> Option<String> {
        let mut state = self.state.lock().unwrap();

        let Some((email, password)) = self.credentials() else {
            // Nothing we can renew a legacy pasted token with.
            return self.legacy_token();
        };

        if Self::throttled(&state) || Self::token_is_fresh(&state) {
            debug!("Token is fresh or login throttled, not logging in again");
            return Self::unexpired_token(&state);
        }
        state.token = None;
        state.exp = None;
        self.login_locked(&mut state, &email, &password)
    }

    /// Forget the cached token and any backoff, e.g. after credentials change.
    pub fn invalidate(&self) {
        let mut state = self.state.lock().unwrap();
        *state = AuthState::default();
    }

    pub fn status(&self) -> AuthStatus {
        let state = self.state.lock().unwrap();
        let has_credentials = self.credentials().is_some();
        let legacy = if has_credentials {
            None
        } else {
            self.legacy_token()
        };
        let (mode, configured) = if has_credentials {
            ("credentials", true)
        } else if legacy.is_some() {
            ("legacy_token", true)
        } else {
            ("none", false)
        };
        let (logged_in, token_expires) = match (&state.token, has_credentials) {
            (Some(_), true) => (!Self::is_expired(state.exp), state.exp),
            (_, false) => match &legacy {
                Some(t) => {
                    let exp = parse_jwt_exp(t);
                    (!Self::is_expired(exp), exp)
                }
                None => (false, None),
            },
            _ => (false, None),
        };
        AuthStatus {
            configured,
            mode,
            logged_in,
            token_expires,
            last_error: state.last_error.clone(),
        }
    }

    /// Try a login without touching the cached token. Used by the UI's
    /// "Test login" button.
    pub fn test_login(&self, email: &str, password: &str) -> Result<(), String> {
        let hub_url = self.hub_url().ok_or_else(|| {
            "No Beszel page is configured yet, so there is no hub URL to test against".to_string()
        })?;
        login(&hub_url, email, password).map(|_| ())
    }

    // --- internals -------------------------------------------------------

    fn login_locked(&self, state: &mut AuthState, email: &str, password: &str) -> Option<String> {
        state.last_attempt = Some(Instant::now());

        let Some(hub_url) = self.hub_url() else {
            state.last_error = Some("No Beszel page configured, no hub URL".to_string());
            return None;
        };

        match login(&hub_url, email, password) {
            Ok(token) => {
                let exp = parse_jwt_exp(&token);
                info!(expires = ?exp, "Logged in to Beszel");
                state.token = Some(token.clone());
                state.exp = exp;
                state.logged_in_at = Some(Instant::now());
                state.last_error = None;
                Some(token)
            }
            Err(e) => {
                warn!(error = %e, "Beszel login failed");
                state.last_error = Some(e);
                Self::unexpired_token(state)
            }
        }
    }

    fn throttled(state: &AuthState) -> bool {
        state
            .last_attempt
            .is_some_and(|t| t.elapsed() < MIN_LOGIN_INTERVAL)
    }

    fn token_is_fresh(state: &AuthState) -> bool {
        state.token.is_some()
            && state
                .logged_in_at
                .is_some_and(|t| t.elapsed() < MIN_TOKEN_AGE_FOR_FORCED_RELOGIN)
    }

    fn unexpired_token(state: &AuthState) -> Option<String> {
        match &state.token {
            Some(t) if !Self::is_expired(state.exp) => Some(t.clone()),
            _ => None,
        }
    }

    fn needs_renewal(exp: Option<i64>) -> bool {
        match exp {
            Some(exp) => now_secs() >= exp - RENEW_BEFORE_EXPIRY_SECS,
            // Unknown expiry: be safe and renew.
            None => true,
        }
    }

    fn is_expired(exp: Option<i64>) -> bool {
        exp.is_some_and(|exp| now_secs() >= exp)
    }

    fn credentials(&self) -> Option<(String, String)> {
        let config = self.config.lock().unwrap();
        let auth = config.beszel_auth.as_ref()?;
        if auth.email.trim().is_empty() || auth.password.is_empty() {
            return None;
        }
        Some((auth.email.trim().to_string(), auth.password.clone()))
    }

    /// Pasted token from older versions; only if still valid.
    fn legacy_token(&self) -> Option<String> {
        let config = self.config.lock().unwrap();
        let token = config.beszel_token.as_ref()?.auth_token.clone();
        if token.is_empty() || Self::is_expired(parse_jwt_exp(&token)) {
            return None;
        }
        Some(token)
    }

    /// Hub URL taken from the first page that uses Beszel (all pages share one hub).
    fn hub_url(&self) -> Option<String> {
        let config = self.config.lock().unwrap();
        config
            .custom_pages
            .iter()
            .find_map(|page| match &page.page_type {
                PageType::SystemStats { beszel_hub_url, .. }
                | PageType::GpuStats { beszel_hub_url, .. }
                | PageType::Temps { beszel_hub_url, .. } => {
                    beszel_hub_url.clone().filter(|u| !u.trim().is_empty())
                }
                _ => None,
            })
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// POST /api/collections/users/auth-with-password. Never logs the password.
fn login(hub_url: &str, email: &str, password: &str) -> Result<String, String> {
    let url = format!(
        "{}/api/collections/users/auth-with-password",
        hub_url.trim_end_matches('/')
    );
    let result = ureq::post(&url)
        .timeout(LOGIN_TIMEOUT)
        .send_json(serde_json::json!({ "identity": email, "password": password }));

    match result {
        Ok(resp) => resp
            .into_json::<AuthResponse>()
            .map(|r| r.token)
            .map_err(|e| format!("Unexpected login response: {}", e)),
        Err(ureq::Error::Status(code, resp)) => {
            let message = resp
                .into_json::<serde_json::Value>()
                .ok()
                .and_then(|v| v.get("message").and_then(|m| m.as_str().map(String::from)))
                .unwrap_or_default();
            Err(match code {
                400 | 401 => format!("Invalid email or password ({})", code),
                429 => "Hub is rate limiting logins (429), will retry later".to_string(),
                _ => format!("Hub returned {} {}", code, message)
                    .trim()
                    .to_string(),
            })
        }
        Err(e) => Err(format!("Could not reach the hub: {}", e)),
    }
}

/// Read the `exp` claim out of a JWT without verifying it.
fn parse_jwt_exp(token: &str) -> Option<i64> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    serde_json::from_slice::<JwtClaims>(&bytes)
        .ok()
        .map(|c| c.exp)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt_with_exp(exp: i64) -> String {
        let enc = |s: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s);
        format!(
            "{}.{}.sig",
            enc(r#"{"alg":"HS256"}"#),
            enc(&format!(r#"{{"exp":{}}}"#, exp))
        )
    }

    #[test]
    fn parses_exp_claim() {
        assert_eq!(parse_jwt_exp(&jwt_with_exp(1789594176)), Some(1789594176));
    }

    #[test]
    fn rejects_malformed_tokens() {
        assert_eq!(parse_jwt_exp("not-a-jwt"), None);
        assert_eq!(parse_jwt_exp("a.!!!.c"), None);
        assert_eq!(parse_jwt_exp(""), None);
    }

    #[test]
    fn renewal_window() {
        let now = now_secs();
        assert!(!TokenManager::needs_renewal(Some(now + 7200)));
        assert!(TokenManager::needs_renewal(Some(now + 1800)));
        assert!(TokenManager::needs_renewal(Some(now - 10)));
        assert!(TokenManager::needs_renewal(None));
    }

    #[test]
    fn expiry_check() {
        let now = now_secs();
        assert!(TokenManager::is_expired(Some(now - 1)));
        assert!(!TokenManager::is_expired(Some(now + 100)));
        assert!(!TokenManager::is_expired(None));
    }

    #[test]
    fn throttle_blocks_rapid_retries() {
        let mut state = AuthState::default();
        assert!(!TokenManager::throttled(&state));
        state.last_attempt = Some(Instant::now());
        assert!(TokenManager::throttled(&state));
        state.last_attempt =
            Instant::now().checked_sub(MIN_LOGIN_INTERVAL + Duration::from_secs(1));
        assert!(!TokenManager::throttled(&state));
    }

    #[test]
    fn fresh_token_is_not_replaced_on_forced_refresh() {
        let mut state = AuthState::default();
        assert!(!TokenManager::token_is_fresh(&state));
        state.token = Some("t".into());
        state.logged_in_at = Some(Instant::now());
        assert!(TokenManager::token_is_fresh(&state));
        state.logged_in_at =
            Instant::now().checked_sub(MIN_TOKEN_AGE_FOR_FORCED_RELOGIN + Duration::from_secs(1));
        assert!(!TokenManager::token_is_fresh(&state));
    }

    #[test]
    fn no_credentials_no_token() {
        let tm = TokenManager::new(Arc::new(Mutex::new(Config::default())));
        assert!(tm.get_token().is_none());
        assert!(tm.refresh_token().is_none());
        assert!(!tm.status().configured);
    }

    #[test]
    fn debug_output_hides_secrets() {
        let auth = crate::config::BeszelAuthConfig {
            email: "a@b.c".into(),
            password: "hunter2".into(),
        };
        assert!(!format!("{:?}", auth).contains("hunter2"));
    }
}
