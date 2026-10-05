//! Authentication for the HTTP API.
//!
//! Two independent mechanisms:
//! - A shared API token (`PXLS_AUTH_TOKEN`) checked as `Authorization: Bearer <token>`
//!   on every route except the health check and the webhook receiver.
//! - A per-webhook secret for the webhook receiver, because senders such as
//!   Radarr and Sonarr cannot do a login flow.

use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::Response,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, CorsLayer};

pub const TOKEN_ENV: &str = "PXLS_AUTH_TOKEN";
pub const ORIGINS_ENV: &str = "PXLS_ALLOWED_ORIGINS";
pub const MIN_TOKEN_LEN: usize = 16;
pub const MIN_WEBHOOK_SECRET_LEN: usize = 16;

/// A secret string that never prints its value in `Debug` output.
#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Secret(pub String);

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret([redacted])")
    }
}

/// The configured API token. Cheap to clone; `Debug` is redacted.
#[derive(Clone)]
pub struct AuthConfig {
    token: Arc<str>,
}

impl fmt::Debug for AuthConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AuthConfig { token: [redacted] }")
    }
}

impl AuthConfig {
    pub fn new(token: &str) -> Result<Self, String> {
        let token = token.trim();
        if token.is_empty() {
            return Err(format!("{} is not set", TOKEN_ENV));
        }
        if token.len() < MIN_TOKEN_LEN {
            return Err(format!(
                "{} must be at least {} characters long",
                TOKEN_ENV, MIN_TOKEN_LEN
            ));
        }
        Ok(Self { token: Arc::from(token) })
    }

    /// Fails closed: the server must not start without a usable token.
    pub fn from_env() -> Result<Self, String> {
        Self::new(&std::env::var(TOKEN_ENV).unwrap_or_default())
    }

    fn matches(&self, provided: &str) -> bool {
        constant_time_eq(provided.as_bytes(), self.token.as_bytes())
    }
}

/// Compare two byte strings without short-circuiting on the first difference.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        diff |= (a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0)) as usize;
    }
    diff == 0
}

/// Generate a random secret (64 hex characters).
pub fn generate_secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Routes that do not require the API token.
/// The webhook receiver authenticates with its own per-webhook secret.
fn is_public_path(path: &str) -> bool {
    path == "/api/health" || path.starts_with("/api/webhook/")
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    if scheme.eq_ignore_ascii_case("bearer") {
        Some(token.trim())
    } else {
        None
    }
}

fn unauthorized() -> Response {
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::WWW_AUTHENTICATE, "Bearer")
        .body(r#"{"success":false,"error":"Unauthorized"}"#.into())
        .unwrap()
}

/// Axum middleware: require `Authorization: Bearer <PXLS_AUTH_TOKEN>`.
pub async fn require_token(State(auth): State<AuthConfig>, req: Request, next: Next) -> Response {
    // CORS preflights carry no credentials; the CORS layer answers them.
    if req.method() == Method::OPTIONS || is_public_path(req.uri().path()) {
        return next.run(req).await;
    }
    match bearer_token(req.headers()) {
        Some(token) if auth.matches(token) => next.run(req).await,
        _ => unauthorized(),
    }
}

/// Find the webhook secret a sender supplied. Accepts, in order:
/// the `X-Webhook-Secret` header, the password of HTTP Basic auth
/// (Radarr and Sonarr support this), or a `?secret=` query parameter.
pub fn extract_webhook_secret(headers: &HeaderMap, query: Option<&str>) -> Option<String> {
    if let Some(v) = headers.get("x-webhook-secret").and_then(|v| v.to_str().ok()) {
        return Some(v.trim().to_string());
    }
    if let Some(v) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some((scheme, rest)) = v.split_once(' ') {
            if scheme.eq_ignore_ascii_case("basic") {
                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(rest.trim())
                    .ok()
                    .and_then(|b| String::from_utf8(b).ok());
                if let Some((_user, pass)) = decoded.as_deref().and_then(|d| d.split_once(':')) {
                    return Some(pass.to_string());
                }
            }
        }
    }
    query?.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        if k == "secret" {
            urlencoding::decode(v).ok().map(|s| s.into_owned())
        } else {
            None
        }
    })
}

/// A webhook with no secret configured rejects everything (fail closed).
pub fn webhook_secret_ok(expected: &Secret, provided: Option<&str>) -> bool {
    !expected.0.is_empty()
        && provided.map_or(false, |p| constant_time_eq(p.as_bytes(), expected.0.as_bytes()))
}

/// CORS from `PXLS_ALLOWED_ORIGINS` (comma-separated). With none set, no
/// cross-origin access is granted, which is right when nginx proxies `/api`.
pub fn cors_from_env() -> CorsLayer {
    cors_for_origins(&std::env::var(ORIGINS_ENV).unwrap_or_default())
}

pub fn cors_for_origins(list: &str) -> CorsLayer {
    let origins: Vec<HeaderValue> = list
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();
    if origins.is_empty() {
        return CorsLayer::new();
    }
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{middleware, routing::get, routing::post, Router};

    const TOKEN: &str = "0123456789abcdef-test-token";

    fn app() -> Router {
        let auth = AuthConfig::new(TOKEN).unwrap();
        Router::new()
            .route("/api/config", get(|| async { "secret data" }))
            .route("/api/health", get(|| async { "ok" }))
            .route("/api/webhook/:name", post(|| async { "hook" }))
            .route("/api/webhook-events", get(|| async { "events" }))
            .layer(middleware::from_fn_with_state(auth, require_token))
    }

    /// Serve the app on a random local port and send one real request.
    async fn status(method: &str, uri: &str, auth: Option<&str>) -> StatusCode {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app()).await.unwrap() });

        let mut req = reqwest::Client::new()
            .request(method.parse().unwrap(), format!("http://{}{}", addr, uri));
        if let Some(a) = auth {
            req = req.header("authorization", a);
        }
        let code = req.send().await.unwrap().status().as_u16();
        StatusCode::from_u16(code).unwrap()
    }

    #[tokio::test]
    async fn missing_token_is_rejected() {
        assert_eq!(status("GET", "/api/config", None).await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn wrong_token_is_rejected() {
        let wrong = "Bearer 0123456789abcdef-wrong-token";
        assert_eq!(status("GET", "/api/config", Some(wrong)).await, StatusCode::UNAUTHORIZED);
        assert_eq!(status("GET", "/api/config", Some("Bearer ")).await, StatusCode::UNAUTHORIZED);
        assert_eq!(status("GET", "/api/config", Some(TOKEN)).await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn correct_token_is_accepted() {
        let ok = format!("Bearer {}", TOKEN);
        assert_eq!(status("GET", "/api/config", Some(&ok)).await, StatusCode::OK);
        let lower = format!("bearer {}", TOKEN);
        assert_eq!(status("GET", "/api/config", Some(&lower)).await, StatusCode::OK);
    }

    #[tokio::test]
    async fn health_and_webhook_receiver_are_public() {
        assert_eq!(status("GET", "/api/health", None).await, StatusCode::OK);
        assert_eq!(status("POST", "/api/webhook/radarr", None).await, StatusCode::OK);
    }

    #[tokio::test]
    async fn webhook_admin_routes_are_not_public() {
        // Only the receiver "/api/webhook/<name>" is exempt, not "/api/webhook-events".
        assert_eq!(status("GET", "/api/webhook-events", None).await, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn token_must_be_set_and_long_enough() {
        assert!(AuthConfig::new("").is_err());
        assert!(AuthConfig::new("   ").is_err());
        assert!(AuthConfig::new("short").is_err());
        assert!(AuthConfig::new(TOKEN).is_ok());
    }

    #[test]
    fn secrets_are_redacted_in_debug() {
        assert!(!format!("{:?}", AuthConfig::new(TOKEN).unwrap()).contains(TOKEN));
        assert!(!format!("{:?}", Secret("hunter2-hunter2-xx".into())).contains("hunter2"));
    }

    #[test]
    fn secret_serializes_as_plain_string() {
        let json = serde_json::to_string(&Secret("abc".into())).unwrap();
        assert_eq!(json, "\"abc\"");
        let back: Secret = serde_json::from_str("\"abc\"").unwrap();
        assert_eq!(back, Secret("abc".into()));
    }

    #[test]
    fn webhook_secret_from_header_basic_and_query() {
        let mut h = HeaderMap::new();
        h.insert("x-webhook-secret", "from-header".parse().unwrap());
        assert_eq!(extract_webhook_secret(&h, None).as_deref(), Some("from-header"));

        let mut h = HeaderMap::new();
        // "radarr:from-basic"
        let b64 = base64::engine::general_purpose::STANDARD.encode("radarr:from-basic");
        h.insert(header::AUTHORIZATION, format!("Basic {}", b64).parse().unwrap());
        assert_eq!(extract_webhook_secret(&h, None).as_deref(), Some("from-basic"));

        let h = HeaderMap::new();
        assert_eq!(
            extract_webhook_secret(&h, Some("a=1&secret=from%20query&b=2")).as_deref(),
            Some("from query")
        );
        assert_eq!(extract_webhook_secret(&h, Some("a=1")), None);
        assert_eq!(extract_webhook_secret(&h, None), None);
    }

    #[test]
    fn webhook_secret_check() {
        let expected = Secret("0123456789abcdef0123".into());
        assert!(webhook_secret_ok(&expected, Some("0123456789abcdef0123")));
        assert!(!webhook_secret_ok(&expected, Some("0123456789abcdef0124")));
        assert!(!webhook_secret_ok(&expected, Some("")));
        assert!(!webhook_secret_ok(&expected, None));
        // No secret configured: nothing is accepted, not even an empty one.
        assert!(!webhook_secret_ok(&Secret::default(), Some("")));
        assert!(!webhook_secret_ok(&Secret::default(), None));
    }

    #[test]
    fn generated_secrets_are_long_and_unique() {
        let a = generate_secret();
        assert!(a.len() >= MIN_WEBHOOK_SECRET_LEN);
        assert_ne!(a, generate_secret());
    }

    #[test]
    fn constant_time_eq_basics() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn cors_with_no_origins_builds() {
        let _ = cors_for_origins("");
        let _ = cors_for_origins("http://localhost:3030, https://pxls.example");
    }
}
