//! User accounts: password hashing, access tokens, sessions and lockout.
//!
//! - Passwords are hashed with argon2id (random per-user salt, stored in the PHC string).
//! - Access tokens are short-lived HS256 JWTs. Each carries a session id, and the
//!   middleware checks that session in the database on every request, so a
//!   revoked session stops working immediately rather than when the JWT expires.
//! - Refresh tokens are random, stored only as SHA-256 hashes, and rotate on every
//!   use. Presenting an already-replaced token revokes the whole session.
//! - Failed logins are counted per account name and per IP, with a temporary lockout.
//!   Unknown names are counted too, so lockout and error text reveal nothing about
//!   which accounts exist.
//!
//! Log lines never contain passwords or tokens, and failed logins log a short hash
//! of the name instead of the name (people type passwords into the username box).

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use base64::Engine;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use tracing::{info, warn};

use crate::auth::{constant_time_eq, Secret};
#[cfg(test)]
use crate::database::accounts::Role;
use crate::database::accounts::{AccountsDb, Rotation, Throttle, User};

pub const JWT_SECRET_ENV: &str = "PXLS_JWT_SECRET";
pub const MIN_JWT_SECRET_LEN: usize = 32;

pub const ACCESS_TTL_SECS: i64 = 15 * 60;
/// A refresh token that is not used for this long expires.
pub const REFRESH_IDLE_TTL_SECS: i64 = 7 * 24 * 3600;
/// A session never lasts longer than this, however active.
pub const SESSION_MAX_SECS: i64 = 30 * 24 * 3600;

pub const MIN_PASSWORD_LEN: usize = 12;
pub const MAX_PASSWORD_LEN: usize = 128;
pub const MIN_USERNAME_LEN: usize = 3;
pub const MAX_USERNAME_LEN: usize = 32;

const ACCOUNT_MAX_FAILURES: i64 = 5;
const IP_MAX_FAILURES: i64 = 20;
const SETUP_MAX_FAILURES: i64 = 10;
const FAILURE_WINDOW_SECS: i64 = 15 * 60;
const LOCK_SECS: i64 = 15 * 60;

const JWT_SECRET_META_KEY: &str = "jwt_secret";

pub fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

// ---- randomness and hashing ------------------------------------------------

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    OsRng.fill_bytes(&mut b);
    b
}

fn random_token() -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes::<32>())
}

pub fn hash_refresh_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("password hashing failed: {e}"))
}

pub fn verify_password(hash: &str, password: &str) -> bool {
    PasswordHash::new(hash)
        .map(|h| {
            Argon2::default()
                .verify_password(password.as_bytes(), &h)
                .is_ok()
        })
        .unwrap_or(false)
}

/// Hashing is deliberately slow; keep it off the async worker threads.
pub async fn hash_password_async(password: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|e| e.to_string())?
}

async fn verify_password_async(hash: String, password: String) -> bool {
    tokio::task::spawn_blocking(move || verify_password(&hash, &password))
        .await
        .unwrap_or(false)
}

// ---- input rules -----------------------------------------------------------

pub fn validate_username(username: &str) -> Result<(), String> {
    let n = username.chars().count();
    if !(MIN_USERNAME_LEN..=MAX_USERNAME_LEN).contains(&n) {
        return Err(format!(
            "Username must be {MIN_USERNAME_LEN} to {MAX_USERNAME_LEN} characters"
        ));
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err("Username may only contain letters, numbers, '.', '_' and '-'".into());
    }
    Ok(())
}

pub fn validate_password(password: &str, username: &str) -> Result<(), String> {
    let n = password.chars().count();
    if n < MIN_PASSWORD_LEN {
        return Err(format!(
            "Password must be at least {MIN_PASSWORD_LEN} characters"
        ));
    }
    if n > MAX_PASSWORD_LEN {
        return Err(format!(
            "Password must be at most {MAX_PASSWORD_LEN} characters"
        ));
    }
    if password.eq_ignore_ascii_case(username) {
        return Err("Password must not be the same as the username".into());
    }
    Ok(())
}

// ---- JWT -------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// User id.
    pub sub: String,
    /// Session id.
    pub sid: String,
    pub iat: i64,
    pub exp: i64,
}

pub struct JwtKeys {
    enc: EncodingKey,
    dec: DecodingKey,
}

impl JwtKeys {
    pub fn new(secret: &[u8]) -> Self {
        Self {
            enc: EncodingKey::from_secret(secret),
            dec: DecodingKey::from_secret(secret),
        }
    }

    pub fn issue(&self, user_id: i64, session_id: &str, now: i64) -> Result<String, String> {
        let claims = Claims {
            sub: user_id.to_string(),
            sid: session_id.to_string(),
            iat: now,
            exp: now + ACCESS_TTL_SECS,
        };
        jsonwebtoken::encode(&Header::new(Algorithm::HS256), &claims, &self.enc)
            .map_err(|e| format!("could not sign token: {e}"))
    }

    /// Verify signature, algorithm and expiry (no leeway).
    pub fn verify(&self, token: &str) -> Option<Claims> {
        let mut v = Validation::new(Algorithm::HS256);
        v.leeway = 0;
        v.set_required_spec_claims(&["exp", "sub"]);
        jsonwebtoken::decode::<Claims>(token, &self.dec, &v)
            .ok()
            .map(|d| d.claims)
    }
}

// ---- shared state ----------------------------------------------------------

/// Everything the auth routes and middleware need. Cheap to clone.
#[derive(Clone)]
pub struct AuthState {
    pub db: Arc<AccountsDb>,
    pub keys: Arc<JwtKeys>,
    /// One-time first-run setup code; `None` once an admin exists.
    setup_code: Arc<Mutex<Option<Secret>>>,
    /// Hash verified when a username does not exist, so timing does not reveal it.
    dummy_hash: Arc<String>,
    pub allowed_origins: Arc<Vec<String>>,
}

impl std::fmt::Debug for AuthState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AuthState { [redacted] }")
    }
}

fn format_setup_code() -> String {
    let h = hex::encode(random_bytes::<12>());
    h.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("-")
}

impl AuthState {
    /// Open the account store, load or create the JWT secret, and (when there
    /// are no users) generate and print the one-time setup code.
    pub fn init(db: AccountsDb, allowed_origins: &str) -> Result<Self, String> {
        let secret = match std::env::var(JWT_SECRET_ENV) {
            Ok(s) if !s.trim().is_empty() => {
                let s = s.trim().to_string();
                if s.len() < MIN_JWT_SECRET_LEN {
                    return Err(format!(
                        "{JWT_SECRET_ENV} must be at least {MIN_JWT_SECRET_LEN} characters"
                    ));
                }
                s
            }
            _ => db
                .meta_get_or_create(JWT_SECRET_META_KEY, || hex::encode(random_bytes::<32>()))
                .map_err(|e| format!("could not load the JWT signing secret: {e}"))?,
        };
        let state = Self::with_secret(db, secret.as_bytes(), allowed_origins)?;
        if state.db.user_count().map_err(|e| e.to_string())? == 0 {
            let code = format_setup_code();
            // Printed on purpose, and only here: this is how the person with
            // access to the server proves they own it.
            warn!("No user accounts exist yet. Open pxls in your browser and finish setup.");
            warn!(
                "One-time setup code (valid until an admin exists or the server restarts): {code}"
            );
            *state.setup_code.lock().unwrap_or_else(|e| e.into_inner()) = Some(Secret(code));
        }
        Ok(state)
    }

    pub fn with_secret(
        db: AccountsDb,
        secret: &[u8],
        allowed_origins: &str,
    ) -> Result<Self, String> {
        Ok(Self {
            db: Arc::new(db),
            keys: Arc::new(JwtKeys::new(secret)),
            setup_code: Arc::new(Mutex::new(None)),
            dummy_hash: Arc::new(hash_password("dummy-password-for-timing")?),
            allowed_origins: Arc::new(
                allowed_origins
                    .split(',')
                    .map(|s| s.trim().trim_end_matches('/').to_ascii_lowercase())
                    .filter(|s| !s.is_empty())
                    .collect(),
            ),
        })
    }

    #[cfg(test)]
    pub fn set_setup_code_for_test(&self, code: &str) {
        *self.setup_code.lock().unwrap() = Some(Secret(code.to_string()));
    }
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user: User,
    pub session_id: String,
}

#[derive(Debug, Serialize)]
pub struct Tokens {
    pub access_token: String,
    pub expires_in: i64,
    pub user: User,
    #[serde(skip)]
    pub refresh_token: String,
    #[serde(skip)]
    pub refresh_max_age: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AuthError {
    /// Wrong name or password. One message for every cause.
    Invalid,
    /// Locked out; retry after this many seconds.
    Throttled(i64),
    Internal,
}

fn log_key(name: &str) -> String {
    hex::encode(&Sha256::digest(name.to_lowercase().as_bytes())[..4])
}

fn throttle_key(name: &str) -> String {
    name.trim().to_lowercase().chars().take(64).collect()
}

fn retry_after(until: i64, now: i64) -> i64 {
    (until - now).max(1)
}

impl AuthState {
    // ---- setup -----------------------------------------------------------

    pub fn setup_required(&self) -> bool {
        self.db.user_count().map(|n| n == 0).unwrap_or(false)
    }

    /// Create the first admin. Requires the one-time code from the server log.
    pub async fn setup(
        &self,
        code: &str,
        username: &str,
        password: &str,
        ip: &str,
        user_agent: Option<&str>,
    ) -> Result<Tokens, SetupError> {
        let now = now_secs();
        if let Ok(Throttle::Locked(until)) = self.db.throttle_check("setup-ip", ip, now) {
            return Err(SetupError::Throttled(retry_after(until, now)));
        }
        let ok = {
            let guard = self.setup_code.lock().unwrap_or_else(|e| e.into_inner());
            match guard.as_ref() {
                Some(expected) => constant_time_eq(code.trim().as_bytes(), expected.0.as_bytes()),
                None => false,
            }
        };
        if !ok {
            let _ = self.db.throttle_fail(
                "setup-ip",
                ip,
                now,
                SETUP_MAX_FAILURES,
                FAILURE_WINDOW_SECS,
                LOCK_SECS,
            );
            warn!(target: "pxls::security", ip, "setup rejected: bad or unavailable setup code");
            return Err(SetupError::BadCode);
        }
        validate_username(username).map_err(SetupError::Invalid)?;
        validate_password(password, username).map_err(SetupError::Invalid)?;
        let hash = hash_password_async(password.to_string())
            .await
            .map_err(|_| SetupError::Internal)?;
        let user = match self.db.create_first_admin(username, &hash, now) {
            Ok(Some(u)) => u,
            Ok(None) => return Err(SetupError::BadCode),
            Err(_) => return Err(SetupError::Internal),
        };
        *self.setup_code.lock().unwrap_or_else(|e| e.into_inner()) = None;
        let _ = self.db.throttle_clear("setup-ip", ip);
        info!(target: "pxls::security", ip, user = %user.username, "first admin created");
        self.start_session(user, ip, user_agent, now)
            .map_err(|_| SetupError::Internal)
    }

    // ---- login / refresh -------------------------------------------------

    pub async fn login(
        &self,
        username: &str,
        password: &str,
        ip: &str,
        user_agent: Option<&str>,
    ) -> Result<Tokens, AuthError> {
        let now = now_secs();
        let key = throttle_key(username);
        for (kind, k) in [("login-ip", ip), ("login-user", key.as_str())] {
            if let Ok(Throttle::Locked(until)) = self.db.throttle_check(kind, k, now) {
                warn!(target: "pxls::security", ip, name = %log_key(username), "login blocked: locked out");
                return Err(AuthError::Throttled(retry_after(until, now)));
            }
        }

        let found = self
            .db
            .find_user_with_hash(username.trim())
            .map_err(|_| AuthError::Internal)?;
        // Always do one argon2 verification, against a dummy hash for unknown
        // names, so response time does not reveal whether the account exists.
        let (hash, user) = match found {
            Some(u) => (u.password_hash, Some(u.user)),
            None => ((*self.dummy_hash).clone(), None),
        };
        let password_ok = verify_password_async(hash, password.to_string()).await;

        match user {
            Some(user) if password_ok && !user.disabled => {
                let _ = self.db.throttle_clear("login-user", &key);
                info!(target: "pxls::security", ip, user = %user.username, "login succeeded");
                self.start_session(user, ip, user_agent, now)
                    .map_err(|_| AuthError::Internal)
            }
            other => {
                let user_locked = self
                    .db
                    .throttle_fail(
                        "login-user",
                        &key,
                        now,
                        ACCOUNT_MAX_FAILURES,
                        FAILURE_WINDOW_SECS,
                        LOCK_SECS,
                    )
                    .unwrap_or(false);
                let ip_locked = self
                    .db
                    .throttle_fail(
                        "login-ip",
                        ip,
                        now,
                        IP_MAX_FAILURES,
                        FAILURE_WINDOW_SECS,
                        LOCK_SECS,
                    )
                    .unwrap_or(false);
                let disabled = other.as_ref().is_some_and(|u| u.disabled);
                warn!(
                    target: "pxls::security", ip, name = %log_key(username), disabled,
                    "login failed"
                );
                if user_locked || ip_locked {
                    warn!(target: "pxls::security", ip, name = %log_key(username), "lockout started");
                }
                Err(AuthError::Invalid)
            }
        }
    }

    fn start_session(
        &self,
        user: User,
        ip: &str,
        user_agent: Option<&str>,
        now: i64,
    ) -> Result<Tokens, String> {
        let session_id = uuid::Uuid::new_v4().to_string();
        let refresh = random_token();
        self.db
            .create_session(
                &session_id,
                user.id,
                &hash_refresh_token(&refresh),
                now,
                REFRESH_IDLE_TTL_SECS,
                SESSION_MAX_SECS,
                user_agent
                    .map(|s| s.chars().take(200).collect::<String>())
                    .as_deref(),
                Some(ip),
            )
            .map_err(|e| e.to_string())?;
        let access = self.keys.issue(user.id, &session_id, now)?;
        Ok(Tokens {
            access_token: access,
            expires_in: ACCESS_TTL_SECS,
            user,
            refresh_token: refresh,
            refresh_max_age: REFRESH_IDLE_TTL_SECS,
        })
    }

    /// Exchange a refresh token for a new access token and a new refresh token.
    pub fn refresh(&self, presented: &str, ip: &str) -> Result<Tokens, AuthError> {
        let now = now_secs();
        let new_refresh = random_token();
        let rotation = self
            .db
            .rotate_session(
                &hash_refresh_token(presented),
                &hash_refresh_token(&new_refresh),
                now,
                REFRESH_IDLE_TTL_SECS,
            )
            .map_err(|_| AuthError::Internal)?;
        match rotation {
            Rotation::Rotated {
                session_id,
                user_id,
            } => {
                let user = self
                    .db
                    .get_user(user_id)
                    .map_err(|_| AuthError::Internal)?
                    .ok_or(AuthError::Invalid)?;
                let access = self
                    .keys
                    .issue(user.id, &session_id, now)
                    .map_err(|_| AuthError::Internal)?;
                Ok(Tokens {
                    access_token: access,
                    expires_in: ACCESS_TTL_SECS,
                    user,
                    refresh_token: new_refresh,
                    refresh_max_age: REFRESH_IDLE_TTL_SECS,
                })
            }
            Rotation::Reuse {
                session_id,
                user_id,
            } => {
                warn!(
                    target: "pxls::security", ip, session = %session_id, user_id,
                    "refresh token reuse detected; session revoked"
                );
                Err(AuthError::Invalid)
            }
            Rotation::Invalid => Err(AuthError::Invalid),
        }
    }

    /// Revoke the session behind a refresh token (logout). Quiet if unknown.
    pub fn logout_refresh(&self, presented: &str) {
        let now = now_secs();
        if let Ok(Some((sid, uid))) = self.db.session_for_refresh(&hash_refresh_token(presented)) {
            if self
                .db
                .revoke_session(uid, &sid, now, "logout")
                .unwrap_or(false)
            {
                info!(target: "pxls::security", user_id = uid, session = %sid, "logout");
            }
        }
    }

    // ---- access-token check ---------------------------------------------

    /// Resolve a bearer token to a live session and an enabled user.
    pub fn authenticate(&self, token: &str) -> Option<AuthUser> {
        let claims = self.keys.verify(token)?;
        let uid: i64 = claims.sub.parse().ok()?;
        let user = self.db.session_user(&claims.sid, uid, now_secs()).ok()??;
        Some(AuthUser {
            user,
            session_id: claims.sid,
        })
    }

    // ---- password and user management -----------------------------------

    /// Change your own password. Revokes every session, including this one.
    pub async fn change_password(
        &self,
        user: &User,
        current: &str,
        new: &str,
        ip: &str,
    ) -> Result<(), PasswordError> {
        let now = now_secs();
        let key = user.id.to_string();
        if let Ok(Throttle::Locked(until)) = self.db.throttle_check("password-user", &key, now) {
            return Err(PasswordError::Throttled(retry_after(until, now)));
        }
        validate_password(new, &user.username).map_err(PasswordError::Invalid)?;
        let stored = self
            .db
            .user_with_hash_by_id(user.id)
            .map_err(|_| PasswordError::Internal)?
            .ok_or(PasswordError::Internal)?;
        if !verify_password_async(stored.password_hash, current.to_string()).await {
            let _ = self.db.throttle_fail(
                "password-user",
                &key,
                now,
                ACCOUNT_MAX_FAILURES,
                FAILURE_WINDOW_SECS,
                LOCK_SECS,
            );
            warn!(target: "pxls::security", ip, user = %user.username, "password change rejected: wrong current password");
            return Err(PasswordError::WrongCurrent);
        }
        let hash = hash_password_async(new.to_string())
            .await
            .map_err(|_| PasswordError::Internal)?;
        self.db
            .set_password(user.id, &hash, now)
            .map_err(|_| PasswordError::Internal)?;
        let _ = self.db.throttle_clear("password-user", &key);
        info!(target: "pxls::security", ip, user = %user.username, "password changed; all sessions revoked");
        Ok(())
    }

    /// Admin sets a user's password. Revokes all of that user's sessions.
    pub async fn admin_set_password(&self, target: &User, new: &str) -> Result<(), PasswordError> {
        validate_password(new, &target.username).map_err(PasswordError::Invalid)?;
        let hash = hash_password_async(new.to_string())
            .await
            .map_err(|_| PasswordError::Internal)?;
        self.db
            .set_password(target.id, &hash, now_secs())
            .map_err(|_| PasswordError::Internal)?;
        Ok(())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum SetupError {
    BadCode,
    Throttled(i64),
    Invalid(String),
    Internal,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PasswordError {
    WrongCurrent,
    Throttled(i64),
    Invalid(String),
    Internal,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hash_round_trip_with_unique_salts() {
        let a = hash_password("correct horse battery").unwrap();
        let b = hash_password("correct horse battery").unwrap();
        assert!(a.starts_with("$argon2id$"));
        assert_ne!(a, b, "each hash gets its own salt");
        assert!(verify_password(&a, "correct horse battery"));
        assert!(!verify_password(&a, "correct horse batterz"));
        assert!(!verify_password("not a hash", "x"));
    }

    #[test]
    fn password_and_username_rules() {
        assert!(validate_password("short", "bob").is_err());
        assert!(validate_password(&"a".repeat(129), "bob").is_err());
        assert!(validate_password("Bob-Is-The-Name", "bob-is-the-name").is_err());
        assert!(validate_password("a long enough passphrase", "bob").is_ok());
        assert!(validate_username("ab").is_err());
        assert!(validate_username("has space").is_err());
        assert!(validate_username("ok.name_1-x").is_ok());
    }

    #[test]
    fn jwt_round_trip_tamper_and_expiry() {
        let keys = JwtKeys::new(b"0123456789abcdef0123456789abcdef");
        let now = now_secs();
        let t = keys.issue(7, "sess-1", now).unwrap();
        let c = keys.verify(&t).unwrap();
        assert_eq!((c.sub.as_str(), c.sid.as_str()), ("7", "sess-1"));
        assert_eq!(c.exp - c.iat, ACCESS_TTL_SECS);

        // Signed with another key: rejected.
        let other = JwtKeys::new(b"fedcba9876543210fedcba9876543210");
        assert!(other.verify(&t).is_none());
        // Payload tampered: rejected.
        let mut parts: Vec<&str> = t.split('.').collect();
        let forged = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(format!(
            r#"{{"sub":"1","sid":"sess-1","iat":{now},"exp":{}}}"#,
            now + 999
        ));
        parts[1] = &forged;
        assert!(keys.verify(&parts.join(".")).is_none());
        // Expired: rejected.
        let old = keys.issue(7, "sess-1", now - ACCESS_TTL_SECS - 5).unwrap();
        assert!(keys.verify(&old).is_none());
        // alg=none style tokens are rejected.
        assert!(keys.verify("eyJhbGciOiJub25lIn0.e30.").is_none());
    }

    #[test]
    fn setup_code_has_enough_entropy_and_shape() {
        let c = format_setup_code();
        assert_eq!(c.len(), 24 + 5);
        assert_ne!(c, format_setup_code());
    }
}

/// Shared helpers for tests in this and other modules.
#[cfg(test)]
pub mod test_support {
    use super::*;
    use std::path::PathBuf;

    pub const PASSWORD: &str = "a long test passphrase";

    pub struct TempDir(pub PathBuf);
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A fresh state on its own empty database. Keep the returned dir alive.
    pub fn state() -> (AuthState, TempDir) {
        let dir =
            std::env::temp_dir().join(format!("pxls-auth-test-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = AccountsDb::open(&dir).unwrap();
        let state = AuthState::with_secret(db, b"0123456789abcdef0123456789abcdef", "").unwrap();
        (state, TempDir(dir))
    }

    /// Create a user (password `PASSWORD`) and return a live access token.
    pub async fn login_as(state: &AuthState, name: &str, role: Role) -> String {
        let hash = hash_password(PASSWORD).unwrap();
        state
            .db
            .create_user(name, &hash, role, now_secs())
            .unwrap()
            .unwrap();
        state
            .login(name, PASSWORD, "127.0.0.1", None)
            .await
            .unwrap()
            .access_token
    }
}
