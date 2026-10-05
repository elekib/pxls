use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;

use crate::AppState;

#[derive(Deserialize)]
pub struct TestLoginRequest {
    #[serde(default)]
    pub email: String,
    /// Empty means "use the stored password".
    #[serde(default)]
    pub password: String,
}

/// Current Beszel login state, for the UI. Contains no secrets.
pub async fn auth_status(State(state): State<AppState>) -> impl IntoResponse {
    let tm = state.token_manager.clone();
    match tokio::task::spawn_blocking(move || tm.status()).await {
        Ok(status) => (StatusCode::OK, Json(json!(status))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to read auth status"})),
        ),
    }
}

/// Try a login with the given (or stored) credentials without changing anything.
pub async fn test_login(
    State(state): State<AppState>,
    Json(req): Json<TestLoginRequest>,
) -> impl IntoResponse {
    let email = req.email.trim().to_string();
    let password = if req.password.is_empty() {
        state
            .config
            .lock()
            .ok()
            .and_then(|c| c.beszel_auth.as_ref().map(|a| a.password.clone()))
            .unwrap_or_default()
    } else {
        req.password
    };

    if email.is_empty() || password.is_empty() {
        return (
            StatusCode::OK,
            Json(json!({"success": false, "error": "Enter an email and password"})),
        );
    }

    let tm = state.token_manager.clone();
    match tokio::task::spawn_blocking(move || tm.test_login(&email, &password)).await {
        Ok(Ok(())) => (StatusCode::OK, Json(json!({"success": true}))),
        Ok(Err(e)) => (StatusCode::OK, Json(json!({"success": false, "error": e}))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "error": "Login test failed to run"})),
        ),
    }
}
