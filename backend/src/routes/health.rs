use axum::{
    Json,
    response::Response,
    http::{StatusCode, header},
};
use serde_json::json;
use tracing::instrument;

#[instrument]
pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}

pub async fn not_found() -> Response {
    let error = json!({"error": "Not found"});
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "application/json")
        .body(error.to_string().into())
        .unwrap()
}
