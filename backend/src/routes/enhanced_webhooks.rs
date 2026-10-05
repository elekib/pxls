use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use serde_json::{json, Value};
use tracing::{info, instrument};
use uuid::Uuid;

use crate::webhook_enhanced::{
    validate_action, validate_rule, EnhancedWebhookConfig, WebhookAction, WebhookRule,
};
use crate::AppState;

fn json_response(status: StatusCode, body: Value) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.to_string().into())
        .unwrap()
}

fn error_response(status: StatusCode, message: String) -> Response {
    json_response(status, json!({ "success": false, "error": message }))
}

fn parse_rules(value: &Value) -> Result<Vec<WebhookRule>, String> {
    let mut rules: Vec<WebhookRule> =
        serde_json::from_value(value.clone()).map_err(|e| format!("Invalid rules: {e}"))?;
    for rule in &mut rules {
        if rule.id.is_empty() {
            rule.id = Uuid::new_v4().to_string();
        }
        validate_rule(rule)?;
    }
    Ok(rules)
}

fn parse_actions(value: &Value) -> Result<Vec<WebhookAction>, String> {
    let actions: Vec<WebhookAction> =
        serde_json::from_value(value.clone()).map_err(|e| format!("Invalid actions: {e}"))?;
    for action in &actions {
        validate_action(action)?;
    }
    Ok(actions)
}

fn str_field<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(|v| v.as_str())
}

#[instrument(skip(state))]
pub async fn get_enhanced_webhooks(State(state): State<AppState>) -> Response {
    let db = match state.webhook_database.load_webhooks() {
        Ok(db) => db,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load webhooks: {e}"),
            );
        }
    };

    json_response(
        StatusCode::OK,
        json!({
            "success": true,
            "webhooks": db.webhooks,
        }),
    )
}

#[instrument(skip(state))]
pub async fn get_enhanced_webhook(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Response {
    let db = match state.webhook_database.load_webhooks() {
        Ok(db) => db,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load webhooks: {e}"),
            );
        }
    };

    let webhook = match db
        .webhooks
        .iter()
        .find(|w| w.path == name || w.name == name)
    {
        Some(w) => w,
        None => {
            return error_response(StatusCode::NOT_FOUND, format!("Webhook '{name}' not found"));
        }
    };

    json_response(
        StatusCode::OK,
        json!({
            "success": true,
            "webhook": webhook,
        }),
    )
}

#[instrument(skip(state, payload))]
pub async fn create_enhanced_webhook(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Response {
    let name = match str_field(&payload, "name") {
        Some(n) if !n.trim().is_empty() => n.to_string(),
        _ => return error_response(StatusCode::BAD_REQUEST, "name is required".to_string()),
    };

    let path = str_field(&payload, "path")
        .filter(|p| !p.trim().is_empty())
        .unwrap_or(&name)
        .to_string();

    let rules = match payload.get("rules") {
        Some(v) => match parse_rules(v) {
            Ok(r) => r,
            Err(e) => return error_response(StatusCode::BAD_REQUEST, e),
        },
        None => Vec::new(),
    };

    let default_actions = match payload.get("default_actions") {
        Some(v) => match parse_actions(v) {
            Ok(a) => a,
            Err(e) => return error_response(StatusCode::BAD_REQUEST, e),
        },
        None => Vec::new(),
    };

    let webhook = EnhancedWebhookConfig {
        name,
        enabled: payload
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        path,
        secret: crate::auth::Secret(
            str_field(&payload, "secret")
                .filter(|s| s.len() >= crate::auth::MIN_WEBHOOK_SECRET_LEN)
                .map(str::to_string)
                .unwrap_or_else(crate::auth::generate_secret),
        ),
        log_events: payload
            .get("log_events")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        max_events: payload
            .get("max_events")
            .and_then(|v| v.as_u64())
            .unwrap_or(100) as usize,
        rules,
        default_actions,
        display_on_no_match: payload
            .get("display_on_no_match")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        // Default display settings
        duration_secs: payload
            .get("duration_secs")
            .and_then(|v| v.as_u64())
            .unwrap_or(10) as u32,
        display_mode: str_field(&payload, "display_mode")
            .unwrap_or("icon_only")
            .to_string(),
        background_color: str_field(&payload, "background_color")
            .unwrap_or("FF0000")
            .to_string(),
        text_color: str_field(&payload, "text_color")
            .unwrap_or("FFFFFF")
            .to_string(),
        title_field: str_field(&payload, "title_field")
            .unwrap_or("title")
            .to_string(),
        subtitle_field: str_field(&payload, "subtitle_field")
            .unwrap_or("subtitle")
            .to_string(),
        flash: payload
            .get("flash")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        flash_speed_ms: payload
            .get("flash_speed_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(500) as u32,
        icon: str_field(&payload, "icon").unwrap_or("📺").to_string(),
        icon_image_url: str_field(&payload, "icon_image_url")
            .unwrap_or("")
            .to_string(),
        image_url_field: str_field(&payload, "image_url_field")
            .unwrap_or("")
            .to_string(),
    };

    let mut db = match state.webhook_database.load_webhooks() {
        Ok(db) => db,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load webhooks: {e}"),
            );
        }
    };

    if db
        .webhooks
        .iter()
        .any(|w| w.name == webhook.name || w.path == webhook.path)
    {
        return error_response(
            StatusCode::CONFLICT,
            format!("Webhook '{}' already exists", webhook.name),
        );
    }

    db.webhooks.push(webhook.clone());

    if let Err(e) = state.webhook_database.save_webhooks(&db) {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save webhook: {e}"),
        );
    }

    info!("Created enhanced webhook: {}", webhook.name);
    json_response(
        StatusCode::CREATED,
        json!({
            "success": true,
            "webhook": webhook,
        }),
    )
}

#[instrument(skip(state, payload))]
pub async fn update_enhanced_webhook(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let mut db = match state.webhook_database.load_webhooks() {
        Ok(db) => db,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load webhooks: {e}"),
            );
        }
    };

    let webhook = match db
        .webhooks
        .iter_mut()
        .find(|w| w.path == name || w.name == name)
    {
        Some(w) => w,
        None => {
            return error_response(StatusCode::NOT_FOUND, format!("Webhook '{name}' not found"));
        }
    };

    if let Some(v) = str_field(&payload, "name") {
        if !v.trim().is_empty() {
            webhook.name = v.to_string();
        }
    }
    if let Some(v) = str_field(&payload, "path") {
        if !v.trim().is_empty() {
            webhook.path = v.to_string();
        }
    }
    if payload.get("regenerate_secret").and_then(|v| v.as_bool()) == Some(true) {
        webhook.secret = crate::auth::Secret(crate::auth::generate_secret());
    } else if let Some(v) = str_field(&payload, "secret") {
        if v.len() >= crate::auth::MIN_WEBHOOK_SECRET_LEN {
            webhook.secret = crate::auth::Secret(v.to_string());
        }
    }
    if let Some(v) = payload.get("enabled").and_then(|v| v.as_bool()) {
        webhook.enabled = v;
    }
    if let Some(v) = payload.get("log_events").and_then(|v| v.as_bool()) {
        webhook.log_events = v;
    }
    if let Some(v) = payload.get("max_events").and_then(|v| v.as_u64()) {
        webhook.max_events = v as usize;
    }
    if let Some(v) = payload.get("display_on_no_match").and_then(|v| v.as_bool()) {
        webhook.display_on_no_match = v;
    }

    if let Some(v) = payload.get("rules") {
        match parse_rules(v) {
            Ok(rules) => webhook.rules = rules,
            Err(e) => return error_response(StatusCode::BAD_REQUEST, e),
        }
    }

    if let Some(v) = payload.get("default_actions") {
        match parse_actions(v) {
            Ok(actions) => webhook.default_actions = actions,
            Err(e) => return error_response(StatusCode::BAD_REQUEST, e),
        }
    }

    if let Some(v) = payload.get("duration_secs").and_then(|v| v.as_u64()) {
        webhook.duration_secs = v as u32;
    }
    if let Some(v) = str_field(&payload, "display_mode") {
        webhook.display_mode = v.to_string();
    }
    if let Some(v) = str_field(&payload, "background_color") {
        webhook.background_color = v.to_string();
    }
    if let Some(v) = str_field(&payload, "text_color") {
        webhook.text_color = v.to_string();
    }
    if let Some(v) = str_field(&payload, "title_field") {
        webhook.title_field = v.to_string();
    }
    if let Some(v) = str_field(&payload, "subtitle_field") {
        webhook.subtitle_field = v.to_string();
    }
    if let Some(v) = payload.get("flash").and_then(|v| v.as_bool()) {
        webhook.flash = v;
    }
    if let Some(v) = payload.get("flash_speed_ms").and_then(|v| v.as_u64()) {
        webhook.flash_speed_ms = v as u32;
    }
    if let Some(v) = str_field(&payload, "icon") {
        webhook.icon = v.to_string();
    }
    if let Some(v) = str_field(&payload, "icon_image_url") {
        webhook.icon_image_url = v.to_string();
    }
    if let Some(v) = str_field(&payload, "image_url_field") {
        webhook.image_url_field = v.to_string();
    }

    let webhook_clone = webhook.clone();

    if let Err(e) = state.webhook_database.save_webhooks(&db) {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save webhook: {e}"),
        );
    }

    info!("Updated enhanced webhook: {}", webhook_clone.name);
    json_response(
        StatusCode::OK,
        json!({
            "success": true,
            "webhook": webhook_clone,
        }),
    )
}

#[instrument(skip(state))]
pub async fn delete_enhanced_webhook(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Response {
    let mut db = match state.webhook_database.load_webhooks() {
        Ok(db) => db,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load webhooks: {e}"),
            );
        }
    };

    let original_len = db.webhooks.len();
    db.webhooks.retain(|w| w.name != name && w.path != name);

    if db.webhooks.len() == original_len {
        return error_response(StatusCode::NOT_FOUND, format!("Webhook '{name}' not found"));
    }

    if let Err(e) = state.webhook_database.save_webhooks(&db) {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save webhook: {e}"),
        );
    }

    info!("Deleted enhanced webhook: {}", name);
    json_response(
        StatusCode::OK,
        json!({
            "success": true,
            "message": format!("Webhook '{}' deleted", name),
        }),
    )
}
