//! Admin user management under `/api/users` (the middleware enforces the admin role).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Response,
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;
use tracing::info;

use super::account::{error, json_response};
use crate::accounts::{
    hash_password_async, now_secs, validate_password, validate_username, AuthState, AuthUser,
    PasswordError,
};
use crate::database::accounts::{Role, UserError};

fn user_error(e: UserError) -> Response {
    let status = match e {
        UserError::Duplicate => StatusCode::CONFLICT,
        UserError::NotFound => StatusCode::NOT_FOUND,
        UserError::LastAdmin => StatusCode::CONFLICT,
    };
    error(status, &e.to_string())
}

fn internal() -> Response {
    error(StatusCode::INTERNAL_SERVER_ERROR, "Request failed")
}

pub async fn list_users(State(auth): State<AuthState>) -> Response {
    match auth.db.list_users() {
        Ok(users) => json_response(StatusCode::OK, json!({ "success": true, "users": users })),
        Err(_) => internal(),
    }
}

#[derive(Deserialize)]
pub struct CreateBody {
    username: String,
    password: String,
    role: Option<Role>,
}

pub async fn create_user(
    State(auth): State<AuthState>,
    Extension(me): Extension<AuthUser>,
    Json(body): Json<CreateBody>,
) -> Response {
    let username = body.username.trim();
    if let Err(m) =
        validate_username(username).and_then(|_| validate_password(&body.password, username))
    {
        return error(StatusCode::BAD_REQUEST, &m);
    }
    let Ok(hash) = hash_password_async(body.password).await else {
        return internal();
    };
    let role = body.role.unwrap_or(Role::Viewer);
    match auth.db.create_user(username, &hash, role, now_secs()) {
        Ok(Ok(user)) => {
            info!(target: "pxls::security", admin = %me.user.username, user = %user.username, role = role.as_str(), "user created");
            json_response(
                StatusCode::CREATED,
                json!({ "success": true, "user": user }),
            )
        }
        Ok(Err(e)) => user_error(e),
        Err(_) => internal(),
    }
}

#[derive(Deserialize)]
pub struct UpdateBody {
    role: Option<Role>,
    disabled: Option<bool>,
}

pub async fn update_user(
    State(auth): State<AuthState>,
    Extension(me): Extension<AuthUser>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateBody>,
) -> Response {
    match auth
        .db
        .update_user(id, body.role, body.disabled, now_secs())
    {
        Ok(Ok(user)) => {
            info!(target: "pxls::security", admin = %me.user.username, user = %user.username, disabled = user.disabled, role = user.role.as_str(), "user updated");
            json_response(StatusCode::OK, json!({ "success": true, "user": user }))
        }
        Ok(Err(e)) => user_error(e),
        Err(_) => internal(),
    }
}

pub async fn delete_user(
    State(auth): State<AuthState>,
    Extension(me): Extension<AuthUser>,
    Path(id): Path<i64>,
) -> Response {
    if id == me.user.id {
        return error(
            StatusCode::BAD_REQUEST,
            "You cannot delete your own account",
        );
    }
    match auth.db.delete_user(id) {
        Ok(Ok(())) => {
            info!(target: "pxls::security", admin = %me.user.username, user_id = id, "user deleted");
            json_response(StatusCode::OK, json!({ "success": true }))
        }
        Ok(Err(e)) => user_error(e),
        Err(_) => internal(),
    }
}

#[derive(Deserialize)]
pub struct ResetBody {
    new_password: String,
}

pub async fn reset_password(
    State(auth): State<AuthState>,
    Extension(me): Extension<AuthUser>,
    Path(id): Path<i64>,
    Json(body): Json<ResetBody>,
) -> Response {
    let target = match auth.db.get_user(id) {
        Ok(Some(u)) => u,
        Ok(None) => return user_error(UserError::NotFound),
        Err(_) => return internal(),
    };
    match auth.admin_set_password(&target, &body.new_password).await {
        Ok(()) => {
            info!(target: "pxls::security", admin = %me.user.username, user = %target.username, "password reset; sessions revoked");
            json_response(StatusCode::OK, json!({ "success": true }))
        }
        Err(PasswordError::Invalid(m)) => error(StatusCode::BAD_REQUEST, &m),
        Err(_) => internal(),
    }
}

pub async fn list_user_sessions(State(auth): State<AuthState>, Path(id): Path<i64>) -> Response {
    match auth.db.list_sessions(id, now_secs()) {
        Ok(sessions) => json_response(
            StatusCode::OK,
            json!({ "success": true, "sessions": sessions }),
        ),
        Err(_) => internal(),
    }
}

pub async fn revoke_user_sessions(
    State(auth): State<AuthState>,
    Extension(me): Extension<AuthUser>,
    Path(id): Path<i64>,
) -> Response {
    match auth
        .db
        .revoke_user_sessions(id, None, now_secs(), "revoked-by-admin")
    {
        Ok(n) => {
            info!(target: "pxls::security", admin = %me.user.username, user_id = id, sessions = n, "sessions revoked by admin");
            json_response(StatusCode::OK, json!({ "success": true, "revoked": n }))
        }
        Err(_) => internal(),
    }
}
