pub mod account;
pub mod beszel;
pub mod config;
pub mod debug;
pub mod device;
pub mod enhanced_webhooks;
pub mod health;
pub mod tools;
pub mod upload;
pub mod users;
pub mod webhook_events;
pub mod webhook_rules;
pub mod webhooks;

#[cfg(test)]
mod account_tests;

use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{delete, get, patch, post, put},
    Router,
};

use crate::accounts::AuthState;
use crate::{image_guard, AppState};

/// Every API route. The test below reads this file to check that each path
/// is covered by the auth middleware, so keep `.route("...")` literals here.
fn api_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/config",
            get(self::config::get_config).post(self::config::update_config),
        )
        .route("/api/beszel/status", get(self::beszel::auth_status))
        .route("/api/beszel/test-login", post(self::beszel::test_login))
        .route("/api/connect", post(self::device::connect_device))
        .route("/api/disconnect", post(self::device::disconnect_device))
        .route(
            "/api/connection-status",
            get(self::device::connection_status),
        )
        .route(
            "/api/device-config",
            post(self::device::update_device_config),
        )
        .route(
            "/api/upload",
            post(self::upload::upload_file).layer(DefaultBodyLimit::max(
                image_guard::MAX_UPLOAD_BYTES + 64 * 1024,
            )),
        )
        .route("/api/uploads/:filename", get(self::upload::serve_file))
        .route("/api/health", get(self::health::health_check))
        .route("/api/buzzer", post(self::tools::play_buzzer))
        .route("/api/countdown", post(self::tools::start_countdown))
        .route(
            "/api/sound-detector",
            post(self::tools::start_sound_detector),
        )
        .route("/api/scoreboard", post(self::tools::set_scoreboard))
        .route("/api/stop-tool", post(self::tools::stop_tool))
        .route("/api/debug/status", get(self::debug::status))
        .route("/api/debug/send", post(self::debug::send))
        .route("/api/debug/release", post(self::debug::release))
        .route("/api/webhook/:name", post(self::webhooks::handle_webhook))
        .route(
            "/api/webhook-events",
            get(self::webhook_events::get_webhook_events),
        )
        .route(
            "/api/webhook-events/clear/:webhook_name",
            post(self::webhook_events::clear_webhook_events),
        )
        .route(
            "/api/webhook-events/clear-all",
            post(self::webhook_events::clear_all_webhook_events),
        )
        .route(
            "/api/webhook-events/summary",
            get(self::webhook_events::get_webhook_events_summary),
        )
        .route(
            "/api/webhook-events/:event_id/replay",
            post(self::webhook_events::replay_webhook_event),
        )
        .route(
            "/api/enhanced-webhooks",
            get(self::enhanced_webhooks::get_enhanced_webhooks),
        )
        .route(
            "/api/enhanced-webhooks",
            post(self::enhanced_webhooks::create_enhanced_webhook),
        )
        .route(
            "/api/enhanced-webhooks/:name",
            get(self::enhanced_webhooks::get_enhanced_webhook),
        )
        .route(
            "/api/enhanced-webhooks/:name",
            put(self::enhanced_webhooks::update_enhanced_webhook),
        )
        .route(
            "/api/enhanced-webhooks/:name",
            delete(self::enhanced_webhooks::delete_enhanced_webhook),
        )
        .route(
            "/api/webhooks/:name/rules",
            get(self::webhook_rules::get_webhook_rules),
        )
        .route(
            "/api/webhooks/:name/rules",
            post(self::webhook_rules::create_webhook_rule),
        )
        .route(
            "/api/webhooks/:name/rules/test",
            post(self::webhook_rules::test_webhook_rules),
        )
        .route(
            "/api/webhooks/:name/rules-order",
            put(self::webhook_rules::reorder_webhook_rules),
        )
        .route(
            "/api/webhooks/:name/rules/:rule_id",
            put(self::webhook_rules::update_webhook_rule),
        )
        .route(
            "/api/webhooks/:name/rules/:rule_id",
            delete(self::webhook_rules::delete_webhook_rule),
        )
}

/// Account routes (login flow, self-service, admin user management).
fn account_routes() -> Router<AuthState> {
    Router::new()
        .route("/api/auth/status", get(account::status))
        .route("/api/auth/setup", post(account::setup))
        .route("/api/auth/login", post(account::login))
        .route("/api/auth/refresh", post(account::refresh))
        .route("/api/auth/logout", post(account::logout))
        .route("/api/auth/me", get(account::me))
        .route("/api/auth/password", post(account::change_password))
        .route("/api/auth/sessions", get(account::list_sessions))
        .route("/api/auth/sessions/:id", delete(account::revoke_session))
        .route("/api/auth/logout-all", post(account::logout_all))
        .route(
            "/api/users",
            get(users::list_users).post(users::create_user),
        )
        .route(
            "/api/users/:id",
            patch(users::update_user).delete(users::delete_user),
        )
        .route("/api/users/:id/password", post(users::reset_password))
        .route(
            "/api/users/:id/sessions",
            get(users::list_user_sessions).delete(users::revoke_user_sessions),
        )
}

/// The full HTTP app: API routes plus account routes, behind the auth middleware.
pub fn build_app(
    state: AppState,
    auth_state: AuthState,
    cors: tower_http::cors::CorsLayer,
) -> Router {
    Router::new()
        .merge(api_routes().with_state(state))
        .merge(account_routes().with_state(auth_state.clone()))
        .layer(middleware::from_fn_with_state(
            auth_state,
            crate::auth::require_auth,
        ))
        .layer(cors)
}
