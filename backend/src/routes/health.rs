use axum::Json;
use serde_json::json;
use tracing::instrument;

/// Set at build time by the Dockerfile (`VERSION` / `GIT_SHA` build args).
pub const VERSION: &str = match option_env!("PXLS_VERSION") {
    Some(v) => v,
    None => env!("CARGO_PKG_VERSION"),
};
pub const GIT_SHA: &str = match option_env!("PXLS_GIT_SHA") {
    Some(v) => v,
    None => "unknown",
};

#[instrument]
pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "version": VERSION, "git_sha": GIT_SHA }))
}
