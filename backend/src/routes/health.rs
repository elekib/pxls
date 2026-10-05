use axum::{
    Json,
    response::Response,
    http::{StatusCode, header},
};
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

pub async fn not_found() -> Response {
    let error = json!({"error": "Not found"});
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "application/json")
        .body(error.to_string().into())
        .unwrap()
}
