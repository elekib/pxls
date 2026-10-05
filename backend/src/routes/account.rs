//! Login flow and self-service account endpoints under `/api/auth/`.
//!
//! The refresh token lives in an httpOnly, SameSite=Strict cookie scoped to
//! `/api/auth`, so page scripts never see it. The access token is returned in the
//! JSON body and kept in memory by the UI. Because a cookie is sent automatically,
//! every route that uses it (and login/setup) requires a custom `X-Requested-With`
//! header (a cross-site page cannot send one without a CORS preflight, which is
//! refused) and a same-site `Origin` when the browser sends one.

use axum::{
    extract::{ConnectInfo, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::{IpAddr, SocketAddr};

use crate::accounts::{
    now_secs, AuthError, AuthState, AuthUser, PasswordError, SetupError, Tokens,
};

pub const REFRESH_COOKIE: &str = "pxls_refresh";
const COOKIE_PATH: &str = "/api/auth";
pub const CSRF_HEADER: &str = "x-requested-with";
pub const CSRF_VALUE: &str = "pxls";

pub fn json_response(status: StatusCode, body: Value) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body.to_string().into())
        .unwrap()
}

pub fn error(status: StatusCode, message: &str) -> Response {
    json_response(status, json!({ "success": false, "error": message }))
}

fn throttled(retry_after: i64) -> Response {
    let mut r = error(
        StatusCode::TOO_MANY_REQUESTS,
        "Too many attempts. Try again later.",
    );
    r.headers_mut().insert(
        header::RETRY_AFTER,
        retry_after.to_string().parse().unwrap(),
    );
    r
}

fn invalid_credentials() -> Response {
    error(StatusCode::UNAUTHORIZED, "Invalid username or password")
}

// ---- request helpers -------------------------------------------------------

fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00,
    }
}

/// The client address used for lockout and logs. Behind the bundled nginx the TCP
/// peer is always the proxy, so `X-Real-IP` is honoured, but only when the peer is
/// itself a loopback or private address (never from a public peer).
pub fn client_ip(headers: &HeaderMap, peer: Option<ConnectInfo<SocketAddr>>) -> String {
    let peer_ip = peer.map(|p| p.0.ip());
    if let Some(p) = peer_ip {
        if is_private(p) {
            if let Some(ip) = headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<IpAddr>().ok())
            {
                return ip.to_string();
            }
        }
        return p.to_string();
    }
    "unknown".to_string()
}

fn user_agent(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
}

fn hostname(authority: &str) -> String {
    let a = authority.trim().to_ascii_lowercase();
    let a = a.rsplit_once("://").map_or(a.as_str(), |(_, rest)| rest);
    let a = a.split('/').next().unwrap_or(a);
    if let Some(rest) = a.strip_prefix('[') {
        return rest.split(']').next().unwrap_or(rest).to_string();
    }
    a.split(':').next().unwrap_or(a).to_string()
}

/// CSRF defence for cookie-authenticated and credential endpoints.
pub fn csrf_ok(headers: &HeaderMap, auth: &AuthState) -> bool {
    let ok_header = headers
        .get(CSRF_HEADER)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v == CSRF_VALUE);
    if !ok_header {
        return false;
    }
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        let origin_l = origin.trim_end_matches('/').to_ascii_lowercase();
        let listed = auth.allowed_origins.contains(&origin_l);
        let same_host = headers
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|h| hostname(h) == hostname(origin));
        if !listed && !same_host {
            return false;
        }
    }
    true
}

fn refresh_cookie_value(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|pair| {
            let (k, v) = pair.trim().split_once('=')?;
            (k == REFRESH_COOKIE && !v.is_empty()).then(|| v.to_string())
        })
}

fn cookie_is_secure(headers: &HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("https"))
        || std::env::var("PXLS_COOKIE_SECURE").is_ok_and(|v| v.eq_ignore_ascii_case("true"))
}

fn set_cookie(token: &str, max_age: i64, secure: bool) -> String {
    format!(
        "{REFRESH_COOKIE}={token}; Path={COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age={max_age}{}",
        if secure { "; Secure" } else { "" }
    )
}

fn with_cookie(mut resp: Response, cookie: String) -> Response {
    resp.headers_mut()
        .append(header::SET_COOKIE, cookie.parse().unwrap());
    resp
}

fn tokens_response(t: Tokens, headers: &HeaderMap) -> Response {
    let cookie = set_cookie(
        &t.refresh_token,
        t.refresh_max_age,
        cookie_is_secure(headers),
    );
    with_cookie(
        json_response(
            StatusCode::OK,
            json!({
                "success": true,
                "access_token": t.access_token,
                "expires_in": t.expires_in,
                "user": t.user,
            }),
        ),
        cookie,
    )
}

fn cleared(resp: Response, headers: &HeaderMap) -> Response {
    with_cookie(resp, set_cookie("", 0, cookie_is_secure(headers)))
}

// ---- public endpoints ------------------------------------------------------

pub async fn status(State(auth): State<AuthState>) -> Response {
    json_response(
        StatusCode::OK,
        json!({ "setup_required": auth.setup_required() }),
    )
}

#[derive(Deserialize)]
pub struct SetupBody {
    setup_code: String,
    username: String,
    password: String,
}

pub async fn setup(
    State(auth): State<AuthState>,
    peer: Option<ConnectInfo<SocketAddr>>,
    headers: HeaderMap,
    Json(body): Json<SetupBody>,
) -> Response {
    if !csrf_ok(&headers, &auth) {
        return error(StatusCode::FORBIDDEN, "Forbidden");
    }
    let ip = client_ip(&headers, peer);
    match auth
        .setup(
            &body.setup_code,
            body.username.trim(),
            &body.password,
            &ip,
            user_agent(&headers),
        )
        .await
    {
        Ok(t) => tokens_response(t, &headers),
        Err(SetupError::BadCode) => error(
            StatusCode::FORBIDDEN,
            "Setup is not available or the setup code is wrong",
        ),
        Err(SetupError::Throttled(s)) => throttled(s),
        Err(SetupError::Invalid(m)) => error(StatusCode::BAD_REQUEST, &m),
        Err(SetupError::Internal) => error(StatusCode::INTERNAL_SERVER_ERROR, "Setup failed"),
    }
}

#[derive(Deserialize)]
pub struct LoginBody {
    username: String,
    password: String,
}

pub async fn login(
    State(auth): State<AuthState>,
    peer: Option<ConnectInfo<SocketAddr>>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Response {
    if !csrf_ok(&headers, &auth) {
        return error(StatusCode::FORBIDDEN, "Forbidden");
    }
    let ip = client_ip(&headers, peer);
    match auth
        .login(&body.username, &body.password, &ip, user_agent(&headers))
        .await
    {
        Ok(t) => tokens_response(t, &headers),
        Err(AuthError::Invalid) => invalid_credentials(),
        Err(AuthError::Throttled(s)) => throttled(s),
        Err(AuthError::Internal) => error(StatusCode::INTERNAL_SERVER_ERROR, "Login failed"),
    }
}

pub async fn refresh(
    State(auth): State<AuthState>,
    peer: Option<ConnectInfo<SocketAddr>>,
    headers: HeaderMap,
) -> Response {
    if !csrf_ok(&headers, &auth) {
        return error(StatusCode::FORBIDDEN, "Forbidden");
    }
    let Some(token) = refresh_cookie_value(&headers) else {
        return error(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let ip = client_ip(&headers, peer);
    match auth.refresh(&token, &ip) {
        Ok(t) => tokens_response(t, &headers),
        Err(AuthError::Internal) => error(StatusCode::INTERNAL_SERVER_ERROR, "Refresh failed"),
        Err(_) => cleared(error(StatusCode::UNAUTHORIZED, "Unauthorized"), &headers),
    }
}

pub async fn logout(State(auth): State<AuthState>, headers: HeaderMap) -> Response {
    if !csrf_ok(&headers, &auth) {
        return error(StatusCode::FORBIDDEN, "Forbidden");
    }
    if let Some(token) = refresh_cookie_value(&headers) {
        auth.logout_refresh(&token);
    }
    cleared(
        json_response(StatusCode::OK, json!({ "success": true })),
        &headers,
    )
}

// ---- signed-in endpoints ---------------------------------------------------

pub async fn me(Extension(me): Extension<AuthUser>) -> Response {
    json_response(StatusCode::OK, json!({ "success": true, "user": me.user }))
}

#[derive(Deserialize)]
pub struct PasswordBody {
    current_password: String,
    new_password: String,
}

pub async fn change_password(
    State(auth): State<AuthState>,
    Extension(me): Extension<AuthUser>,
    peer: Option<ConnectInfo<SocketAddr>>,
    headers: HeaderMap,
    Json(body): Json<PasswordBody>,
) -> Response {
    let ip = client_ip(&headers, peer);
    match auth
        .change_password(&me.user, &body.current_password, &body.new_password, &ip)
        .await
    {
        // All sessions are gone, including this one: the client must sign in again.
        Ok(()) => cleared(
            json_response(StatusCode::OK, json!({ "success": true })),
            &headers,
        ),
        Err(PasswordError::WrongCurrent) => {
            error(StatusCode::FORBIDDEN, "Current password is incorrect")
        }
        Err(PasswordError::Throttled(s)) => throttled(s),
        Err(PasswordError::Invalid(m)) => error(StatusCode::BAD_REQUEST, &m),
        Err(PasswordError::Internal) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not change password",
        ),
    }
}

pub async fn list_sessions(
    State(auth): State<AuthState>,
    Extension(me): Extension<AuthUser>,
) -> Response {
    match auth.db.list_sessions(me.user.id, now_secs()) {
        Ok(list) => {
            let sessions: Vec<Value> = list
                .into_iter()
                .map(|s| {
                    let current = s.id == me.session_id;
                    let mut v = serde_json::to_value(s).unwrap_or_default();
                    v["current"] = json!(current);
                    v
                })
                .collect();
            json_response(
                StatusCode::OK,
                json!({ "success": true, "sessions": sessions }),
            )
        }
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "Could not list sessions"),
    }
}

pub async fn revoke_session(
    State(auth): State<AuthState>,
    Extension(me): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Response {
    match auth
        .db
        .revoke_session(me.user.id, &id, now_secs(), "revoked-by-user")
    {
        Ok(true) => json_response(StatusCode::OK, json!({ "success": true })),
        Ok(false) => error(StatusCode::NOT_FOUND, "Session not found"),
        Err(_) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not revoke session",
        ),
    }
}

pub async fn logout_all(
    State(auth): State<AuthState>,
    Extension(me): Extension<AuthUser>,
    headers: HeaderMap,
) -> Response {
    match auth
        .db
        .revoke_user_sessions(me.user.id, None, now_secs(), "logout-all")
    {
        Ok(n) => {
            tracing::info!(target: "pxls::security", user = %me.user.username, sessions = n, "logout everywhere");
            cleared(
                json_response(StatusCode::OK, json!({ "success": true })),
                &headers,
            )
        }
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "Could not log out"),
    }
}
