//! HTTP-level tests of the login flow, sessions, roles and middleware coverage,
//! run against the real router on a random local port.

use reqwest::{Client, Response};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::accounts::test_support::{self, PASSWORD};
use crate::accounts::{now_secs, AuthState, ACCESS_TTL_SECS};
use crate::actions::ActionExecutor;
use crate::config::Config;
use crate::database::accounts::Role;
use crate::database::WebhookDatabase;
use crate::notification::NotificationManager;
use crate::pixoo_wrapper::PixooWrapper;
use crate::token_manager::TokenManager;
use crate::webhook_image_processor::WebhookImageProcessor;
use crate::AppState;

const CODE: &str = "aaaa-bbbb-cccc-dddd-eeee-ffff";

struct App {
    base: String,
    auth: AuthState,
    http: Client,
    _dir: test_support::TempDir,
}

async fn app() -> App {
    let (auth, dir) = test_support::state();
    let config = Arc::new(Mutex::new(Config::default()));
    let pixoo = Arc::new(Mutex::new(PixooWrapper::new()));
    let nm = NotificationManager::new();
    let processor = Arc::new(tokio::sync::Mutex::new(WebhookImageProcessor::new()));
    let state = AppState {
        config: config.clone(),
        pixoo: pixoo.clone(),
        should_reconnect: Arc::new(AtomicBool::new(false)),
        manual_disconnect: Arc::new(AtomicBool::new(false)),
        tool: Arc::new(Mutex::new(crate::tool_state::ToolTimer::default())),
        notification_manager: nm.clone(),
        webhook_image_processor: processor.clone(),
        webhook_database: Arc::new(WebhookDatabase::new(dir.0.to_str().unwrap())),
        action_executor: Arc::new(ActionExecutor::new(nm, processor, pixoo)),
        token_manager: Arc::new(TokenManager::new(config)),
    };
    let router = super::build_app(state, auth.clone(), crate::auth::cors_for_origins(""));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap()
    });
    App {
        base,
        auth,
        http: Client::new(),
        _dir: dir,
    }
}

fn refresh_cookie(r: &Response) -> Option<String> {
    r.headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|c| c.starts_with("pxls_refresh="))
        .map(|c| c.split(';').next().unwrap().to_string())
}

impl App {
    fn req(&self, method: &str, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method.parse().unwrap(), format!("{}{}", self.base, path))
            .header("x-requested-with", "pxls")
    }

    async fn post(&self, path: &str, body: Value) -> Response {
        self.req("POST", path).json(&body).send().await.unwrap()
    }

    async fn login(&self, name: &str, pw: &str) -> Response {
        self.post(
            "/api/auth/login",
            json!({ "username": name, "password": pw }),
        )
        .await
    }

    async fn with_token(&self, method: &str, path: &str, token: &str) -> Response {
        self.req(method, path)
            .header("authorization", format!("Bearer {token}"))
            .send()
            .await
            .unwrap()
    }

    /// Create a user directly and log in. Returns (access token, refresh cookie).
    async fn user(&self, name: &str, role: Role) -> (String, String) {
        let hash = crate::accounts::hash_password(PASSWORD).unwrap();
        self.auth
            .db
            .create_user(name, &hash, role, now_secs())
            .unwrap()
            .unwrap();
        let r = self.login(name, PASSWORD).await;
        assert_eq!(r.status(), 200);
        let cookie = refresh_cookie(&r).unwrap();
        let body: Value = r.json().await.unwrap();
        (body["access_token"].as_str().unwrap().to_string(), cookie)
    }

    async fn refresh(&self, cookie: &str) -> Response {
        self.req("POST", "/api/auth/refresh")
            .header("cookie", cookie)
            .send()
            .await
            .unwrap()
    }
}

#[tokio::test]
async fn first_run_setup_needs_the_code_and_works_once() {
    let a = app().await;
    let body: Value = a
        .req("GET", "/api/auth/status")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["setup_required"], true);

    // No code exists yet (none generated in tests until set), so setup is refused.
    let attempt = |code: &str, user: &str, pw: &str| json!({ "setup_code": code, "username": user, "password": pw });
    assert_eq!(
        a.post("/api/auth/setup", attempt(CODE, "boss", PASSWORD))
            .await
            .status(),
        403
    );

    a.auth.set_setup_code_for_test(CODE);
    // CSRF header required.
    let r = a
        .http
        .post(format!("{}/api/auth/setup", a.base))
        .json(&attempt(CODE, "boss", PASSWORD))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
    // Wrong code, weak password, bad name.
    assert_eq!(
        a.post("/api/auth/setup", attempt("nope", "boss", PASSWORD))
            .await
            .status(),
        403
    );
    assert_eq!(
        a.post("/api/auth/setup", attempt(CODE, "boss", "short"))
            .await
            .status(),
        400
    );
    assert_eq!(
        a.post("/api/auth/setup", attempt(CODE, "b o", PASSWORD))
            .await
            .status(),
        400
    );

    let r = a
        .post("/api/auth/setup", attempt(CODE, "boss", PASSWORD))
        .await;
    assert_eq!(r.status(), 200);
    assert!(refresh_cookie(&r).is_some());
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["user"]["role"], "admin");
    assert!(
        !body.to_string().contains("argon2"),
        "hash must never be returned"
    );

    // The code is spent and setup stays closed.
    a.auth.set_setup_code_for_test(CODE);
    assert_eq!(
        a.post("/api/auth/setup", attempt(CODE, "mallory", PASSWORD))
            .await
            .status(),
        403
    );
    let body: Value = a
        .req("GET", "/api/auth/status")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["setup_required"], false);
}

#[tokio::test]
async fn no_default_credentials_and_errors_do_not_enumerate_users() {
    let a = app().await;
    for (u, p) in [
        ("admin", "admin"),
        ("admin", "password1234"),
        ("root", "root"),
    ] {
        assert_eq!(a.login(u, p).await.status(), 401);
    }
    a.user("alice", Role::Admin).await;
    let wrong_pw = a.login("alice", "totally wrong pass").await;
    let unknown = a.login("nobody", "totally wrong pass").await;
    assert_eq!(wrong_pw.status(), 401);
    assert_eq!(unknown.status(), 401);
    assert_eq!(
        wrong_pw.text().await.unwrap(),
        unknown.text().await.unwrap()
    );
}

#[tokio::test]
async fn login_sets_a_locked_down_refresh_cookie_and_is_case_insensitive() {
    let a = app().await;
    a.user("Alice", Role::Viewer).await;
    let r = a.login("alice", PASSWORD).await;
    assert_eq!(r.status(), 200);
    let raw = r
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .find(|c| c.starts_with("pxls_refresh="))
        .unwrap();
    for attr in ["HttpOnly", "SameSite=Strict", "Path=/api/auth"] {
        assert!(raw.contains(attr), "{raw}");
    }
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["expires_in"], ACCESS_TTL_SECS);
    assert!(!body.to_string().contains("pxls_refresh"));
}

#[tokio::test]
async fn login_requires_csrf_header_and_same_site_origin() {
    let a = app().await;
    a.user("alice", Role::Viewer).await;
    let creds = json!({ "username": "alice", "password": PASSWORD });
    let r = a
        .http
        .post(format!("{}/api/auth/login", a.base))
        .json(&creds)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
    let r = a
        .req("POST", "/api/auth/login")
        .header("origin", "https://evil.example")
        .json(&creds)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
    let host = a.base.trim_start_matches("http://").to_string();
    let r = a
        .req("POST", "/api/auth/login")
        .header("origin", format!("http://{host}"))
        .json(&creds)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
}

#[tokio::test]
async fn account_and_ip_lockout() {
    let a = app().await;
    a.user("alice", Role::Admin).await;
    a.user("bob", Role::Viewer).await;
    for _ in 0..5 {
        assert_eq!(a.login("alice", "wrong wrong wrong").await.status(), 401);
    }
    // Locked: even the right password is refused, with a retry hint.
    let r = a.login("alice", PASSWORD).await;
    assert_eq!(r.status(), 429);
    assert!(r.headers().get("retry-after").is_some());
    // The lockout is per account name, and applies to names that do not exist
    // exactly the same way, so it reveals nothing.
    for _ in 0..5 {
        assert_eq!(a.login("ghost", "wrong wrong wrong").await.status(), 401);
    }
    assert_eq!(a.login("ghost", "wrong wrong wrong").await.status(), 429);
    // The IP counter (10 failures so far) is not yet over its limit of 20, and
    // another account can still sign in.
    assert_eq!(a.login("bob", PASSWORD).await.status(), 200);
}

#[tokio::test]
async fn ip_lockout_blocks_everyone_from_that_address() {
    let a = app().await;
    a.user("bob", Role::Viewer).await;
    for i in 0..20 {
        // Distinct names so only the IP counter trips.
        assert_eq!(
            a.login(&format!("user{i}"), "wrong wrong wrong")
                .await
                .status(),
            401
        );
    }
    assert_eq!(a.login("bob", PASSWORD).await.status(), 429);
}

#[tokio::test]
async fn expired_forged_and_foreign_tokens_are_rejected() {
    let a = app().await;
    let (good, _) = a.user("alice", Role::Admin).await;
    assert_eq!(
        a.with_token("GET", "/api/auth/me", &good).await.status(),
        200
    );

    let claims = a.auth.keys.verify(&good).unwrap();
    let uid: i64 = claims.sub.parse().unwrap();
    let expired = a
        .auth
        .keys
        .issue(uid, &claims.sid, now_secs() - ACCESS_TTL_SECS - 10)
        .unwrap();
    assert_eq!(
        a.with_token("GET", "/api/auth/me", &expired).await.status(),
        401
    );

    let foreign = crate::accounts::JwtKeys::new(b"another-secret-another-secret-123")
        .issue(uid, &claims.sid, now_secs())
        .unwrap();
    assert_eq!(
        a.with_token("GET", "/api/auth/me", &foreign).await.status(),
        401
    );

    // A correctly signed token for a session that does not exist.
    let ghost = a
        .auth
        .keys
        .issue(uid, "no-such-session", now_secs())
        .unwrap();
    assert_eq!(
        a.with_token("GET", "/api/auth/me", &ghost).await.status(),
        401
    );
}

#[tokio::test]
async fn refresh_rotates_and_reuse_revokes_the_session_family() {
    let a = app().await;
    let (access0, cookie_a) = a.user("alice", Role::Admin).await;

    // Rotation: a new cookie and a working access token each time.
    let r = a.refresh(&cookie_a).await;
    assert_eq!(r.status(), 200);
    let cookie_b = refresh_cookie(&r).unwrap();
    assert_ne!(cookie_a, cookie_b);
    let access1 = r.json::<Value>().await.unwrap()["access_token"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        a.with_token("GET", "/api/auth/me", &access1).await.status(),
        200
    );

    let r = a.refresh(&cookie_b).await;
    assert_eq!(r.status(), 200);
    let cookie_c = refresh_cookie(&r).unwrap();

    // Replaying an old token is an attack signal: refused, and the whole session dies,
    // including the newest refresh token and every access token for it.
    assert_eq!(a.refresh(&cookie_b).await.status(), 401);
    assert_eq!(a.refresh(&cookie_c).await.status(), 401);
    assert_eq!(
        a.with_token("GET", "/api/auth/me", &access0).await.status(),
        401
    );
    assert_eq!(
        a.with_token("GET", "/api/auth/me", &access1).await.status(),
        401
    );
}

#[tokio::test]
async fn refresh_needs_cookie_csrf_header_and_a_known_token() {
    let a = app().await;
    let (_, cookie) = a.user("alice", Role::Admin).await;
    assert_eq!(
        a.req("POST", "/api/auth/refresh")
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let no_csrf = a
        .http
        .post(format!("{}/api/auth/refresh", a.base))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(no_csrf.status(), 403);
    assert_eq!(a.refresh("pxls_refresh=made-up-token").await.status(), 401);
    // A failed refresh clears the cookie.
    let r = a.refresh("pxls_refresh=made-up-token").await;
    let cleared = r.headers().get_all("set-cookie").iter().any(|c| {
        let c = c.to_str().unwrap();
        c.starts_with("pxls_refresh=;") && c.contains("Max-Age=0")
    });
    assert!(cleared);
}

#[tokio::test]
async fn logout_revokes_the_session_immediately() {
    let a = app().await;
    let (access, cookie) = a.user("alice", Role::Admin).await;
    let r = a
        .req("POST", "/api/auth/logout")
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(
        a.with_token("GET", "/api/auth/me", &access).await.status(),
        401
    );
    assert_eq!(a.refresh(&cookie).await.status(), 401);
}

#[tokio::test]
async fn sessions_can_be_listed_and_revoked_and_logged_out_everywhere() {
    let a = app().await;
    let (t1, _) = a.user("alice", Role::Admin).await;
    let second = a.login("alice", PASSWORD).await;
    let t2 = second.json::<Value>().await.unwrap()["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    let list: Value = a
        .with_token("GET", "/api/auth/sessions", &t1)
        .await
        .json()
        .await
        .unwrap();
    let sessions = list["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions.iter().filter(|s| s["current"] == true).count(), 1);
    assert!(!list.to_string().contains("refresh"));

    // Revoke the other session; only that one stops working.
    let other = sessions.iter().find(|s| s["current"] == false).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        a.with_token("DELETE", &format!("/api/auth/sessions/{other}"), &t1)
            .await
            .status(),
        200
    );
    assert_eq!(a.with_token("GET", "/api/auth/me", &t1).await.status(), 200);
    assert_eq!(a.with_token("GET", "/api/auth/me", &t2).await.status(), 401);
    // Unknown id.
    assert_eq!(
        a.with_token("DELETE", "/api/auth/sessions/nope", &t1)
            .await
            .status(),
        404
    );

    // Cannot revoke someone else's session.
    let (bob, _) = a.user("bob", Role::Viewer).await;
    let mine = a
        .with_token("GET", "/api/auth/sessions", &t1)
        .await
        .json::<Value>()
        .await
        .unwrap();
    let id = mine["sessions"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(
        a.with_token("DELETE", &format!("/api/auth/sessions/{id}"), &bob)
            .await
            .status(),
        404
    );
    assert_eq!(a.with_token("GET", "/api/auth/me", &t1).await.status(), 200);

    assert_eq!(
        a.with_token("POST", "/api/auth/logout-all", &t1)
            .await
            .status(),
        200
    );
    assert_eq!(a.with_token("GET", "/api/auth/me", &t1).await.status(), 401);
}

#[tokio::test]
async fn password_change_checks_current_password_and_revokes_all_sessions() {
    let a = app().await;
    let (t1, cookie) = a.user("alice", Role::Admin).await;
    let other = a.login("alice", PASSWORD).await;
    let t2 = other.json::<Value>().await.unwrap()["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    let change = |cur: &str, new: &str| json!({ "current_password": cur, "new_password": new });
    let send = |body: Value| {
        a.req("POST", "/api/auth/password")
            .header("authorization", format!("Bearer {t1}"))
            .json(&body)
            .send()
    };
    assert_eq!(
        send(change("wrong wrong wrong", "a brand new passphrase"))
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(send(change(PASSWORD, "short")).await.unwrap().status(), 400);
    assert_eq!(
        send(change(PASSWORD, "a brand new passphrase"))
            .await
            .unwrap()
            .status(),
        200
    );

    for t in [&t1, &t2] {
        assert_eq!(a.with_token("GET", "/api/auth/me", t).await.status(), 401);
    }
    assert_eq!(a.refresh(&cookie).await.status(), 401);
    assert_eq!(a.login("alice", PASSWORD).await.status(), 401);
    assert_eq!(
        a.login("alice", "a brand new passphrase").await.status(),
        200
    );
}

#[tokio::test]
async fn admin_manages_users_and_revocation_is_immediate() {
    let a = app().await;
    let (admin, _) = a.user("root-admin", Role::Admin).await;
    let (viewer, vcookie) = a.user("vera", Role::Viewer).await;

    // Viewers cannot manage users.
    assert_eq!(
        a.with_token("GET", "/api/users", &viewer).await.status(),
        403
    );

    // Create: validation, duplicate (any case), success; the hash is never listed.
    let create = |name: &str, pw: &str, role: &str| {
        a.req("POST", "/api/users")
            .header("authorization", format!("Bearer {admin}"))
            .json(&json!({ "username": name, "password": pw, "role": role }))
            .send()
    };
    assert_eq!(create("x", PASSWORD, "viewer").await.unwrap().status(), 400);
    assert_eq!(
        create("newbie", "short", "viewer").await.unwrap().status(),
        400
    );
    assert_eq!(
        create("newbie", PASSWORD, "superuser")
            .await
            .unwrap()
            .status(),
        422
    );
    assert_eq!(
        create("newbie", PASSWORD, "viewer").await.unwrap().status(),
        201
    );
    assert_eq!(
        create("NEWBIE", PASSWORD, "viewer").await.unwrap().status(),
        409
    );
    let listed = a
        .with_token("GET", "/api/users", &admin)
        .await
        .text()
        .await
        .unwrap();
    assert!(
        listed.contains("newbie")
            && !listed.contains("argon2")
            && !listed.contains("password_hash")
    );
    assert_eq!(a.login("newbie", PASSWORD).await.status(), 200);

    // Disabling a user kills their sessions at once and blocks login.
    let vid = a
        .auth
        .db
        .find_user_with_hash("vera")
        .unwrap()
        .unwrap()
        .user
        .id;
    let patch = |id: i64, body: Value| {
        a.req("PATCH", &format!("/api/users/{id}"))
            .header("authorization", format!("Bearer {admin}"))
            .json(&body)
            .send()
    };
    assert_eq!(
        patch(vid, json!({ "disabled": true }))
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        a.with_token("GET", "/api/auth/me", &viewer).await.status(),
        401
    );
    assert_eq!(a.refresh(&vcookie).await.status(), 401);
    assert_eq!(a.login("vera", PASSWORD).await.status(), 401);
    assert_eq!(
        patch(vid, json!({ "disabled": false }))
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(a.login("vera", PASSWORD).await.status(), 200);

    // Admin revoke: sessions end, account stays.
    let (v2, _) = {
        let r = a.login("vera", PASSWORD).await;
        let c = refresh_cookie(&r).unwrap();
        (
            r.json::<Value>().await.unwrap()["access_token"]
                .as_str()
                .unwrap()
                .to_string(),
            c,
        )
    };
    assert_eq!(
        a.with_token("DELETE", &format!("/api/users/{vid}/sessions"), &admin)
            .await
            .status(),
        200
    );
    assert_eq!(a.with_token("GET", "/api/auth/me", &v2).await.status(), 401);

    // Admin password reset revokes sessions; new password works, old does not.
    let r = a.login("vera", PASSWORD).await;
    let v3 = r.json::<Value>().await.unwrap()["access_token"]
        .as_str()
        .unwrap()
        .to_string();
    let reset = a
        .req("POST", &format!("/api/users/{vid}/password"))
        .header("authorization", format!("Bearer {admin}"))
        .json(&json!({ "new_password": "reset by the admin 99" }))
        .send()
        .await
        .unwrap();
    assert_eq!(reset.status(), 200);
    assert_eq!(a.with_token("GET", "/api/auth/me", &v3).await.status(), 401);
    assert_eq!(a.login("vera", PASSWORD).await.status(), 401);
    assert_eq!(a.login("vera", "reset by the admin 99").await.status(), 200);

    // Delete: gone, sessions gone. Cannot delete yourself or the last admin.
    let (v4, _) = {
        let r = a.login("vera", "reset by the admin 99").await;
        let c = refresh_cookie(&r).unwrap();
        (
            r.json::<Value>().await.unwrap()["access_token"]
                .as_str()
                .unwrap()
                .to_string(),
            c,
        )
    };
    assert_eq!(
        a.with_token("DELETE", &format!("/api/users/{vid}"), &admin)
            .await
            .status(),
        200
    );
    assert_eq!(a.with_token("GET", "/api/auth/me", &v4).await.status(), 401);
    let me = a
        .auth
        .db
        .find_user_with_hash("root-admin")
        .unwrap()
        .unwrap()
        .user
        .id;
    assert_eq!(
        a.with_token("DELETE", &format!("/api/users/{me}"), &admin)
            .await
            .status(),
        400
    );
    assert_eq!(
        patch(me, json!({ "role": "viewer" }))
            .await
            .unwrap()
            .status(),
        409
    );
    assert_eq!(
        patch(me, json!({ "disabled": true }))
            .await
            .unwrap()
            .status(),
        409
    );
}

#[tokio::test]
async fn every_route_is_covered_by_the_auth_middleware() {
    let a = app().await;
    let (viewer, _) = a.user("vera", Role::Viewer).await;

    // Pull every registered path out of the route table so a new route that
    // is not covered cannot slip in unnoticed.
    let src = include_str!("mod.rs");
    let mut paths: Vec<String> = Vec::new();
    for chunk in src.split(".route(").skip(1) {
        let chunk = chunk.trim_start();
        if let Some(rest) = chunk.strip_prefix('"') {
            if let Some(end) = rest.find('"') {
                if rest.starts_with("/api/") {
                    paths.push(rest[..end].to_string());
                }
            }
        }
    }
    assert!(paths.len() > 30, "route scan found only {}", paths.len());
    paths.push("/api/not-a-route".into());

    let mut public = Vec::new();
    for raw in &paths {
        let path: String = raw
            .split('/')
            .map(|seg| if seg.starts_with(':') { "x" } else { seg })
            .collect::<Vec<_>>()
            .join("/");
        for method in ["GET", "POST", "PUT", "PATCH", "DELETE"] {
            let r = a
                .http
                .request(method.parse().unwrap(), format!("{}{}", a.base, path))
                .send()
                .await
                .unwrap();
            if crate::auth::is_public_path(&path) {
                public.push(path.clone());
            } else {
                assert_eq!(
                    r.status(),
                    401,
                    "{method} {path} must require authentication"
                );
                // A signed-in viewer is held to the role policy for every route. The
                // self-service /api/auth routes are skipped here: calling logout-all
                // would end the viewer's own session; they are tested above.
                if path.starts_with("/api/auth/") {
                    continue;
                }
                let need = crate::auth::required_role(&method.parse().unwrap(), &path);
                let v = a.with_token(method, &path, &viewer).await;
                if need == Role::Admin {
                    assert_eq!(v.status(), 403, "{method} {path} must be admin only");
                } else {
                    assert_ne!(v.status(), 403, "{method} {path} should be open to viewers");
                    assert_ne!(v.status(), 401, "{method} {path}");
                }
            }
        }
    }
    public.sort();
    public.dedup();
    assert_eq!(
        public,
        [
            "/api/auth/login",
            "/api/auth/logout",
            "/api/auth/refresh",
            "/api/auth/setup",
            "/api/auth/status",
            "/api/health",
            "/api/webhook/x",
        ],
        "the set of public routes changed; review it"
    );
}

#[tokio::test]
async fn webhook_receiver_does_not_accept_a_user_token_in_place_of_its_secret() {
    let a = app().await;
    let (admin, _) = a.user("alice", Role::Admin).await;
    // Open to the middleware, but the webhook's own secret is still required.
    let r = a
        .req("POST", "/api/webhook/radarr")
        .header("authorization", format!("Bearer {admin}"))
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    let r = a
        .req("POST", "/api/webhook/radarr")
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
}
