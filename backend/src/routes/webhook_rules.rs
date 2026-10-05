use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use serde_json::{json, Value};
use tracing::{info, instrument};
use uuid::Uuid;

use crate::webhook_enhanced::{evaluate_rule_verbose, validate_rule, WebhookRule};
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

/// Deserialize and validate a rule from a JSON payload, filling in id/name.
fn parse_rule(payload: &Value) -> Result<WebhookRule, String> {
    let mut rule: WebhookRule =
        serde_json::from_value(payload.clone()).map_err(|e| format!("Invalid rule: {}", e))?;

    if rule.name.trim().is_empty() {
        rule.name = format!("rule_{}", Uuid::new_v4());
    }
    if rule.id.is_empty() {
        rule.id = Uuid::new_v4().to_string();
    }

    validate_rule(&rule)?;
    Ok(rule)
}

fn rule_matches_key(rule: &WebhookRule, key: &str) -> bool {
    rule.id == key || rule.name == key
}

#[instrument(skip(state))]
pub async fn get_webhook_rules(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Response {
    let webhook_db = match state.webhook_database.load_webhooks() {
        Ok(db) => db,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load webhooks: {}", e),
            );
        }
    };

    let webhook = match webhook_db
        .webhooks
        .iter()
        .find(|w| w.path == name || w.name == name)
    {
        Some(w) => w,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Webhook '{}' not found", name),
            );
        }
    };

    json_response(
        StatusCode::OK,
        json!({
            "success": true,
            "webhook": webhook.name,
            "rules": webhook.rules,
        }),
    )
}

#[instrument(skip(state, payload))]
pub async fn create_webhook_rule(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    let rule = match parse_rule(&payload) {
        Ok(r) => r,
        Err(e) => return error_response(StatusCode::BAD_REQUEST, e),
    };

    let mut webhook_db = match state.webhook_database.load_webhooks() {
        Ok(db) => db,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load webhooks: {}", e),
            );
        }
    };

    let webhook = match webhook_db
        .webhooks
        .iter_mut()
        .find(|w| w.path == name || w.name == name)
    {
        Some(w) => w,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Webhook '{}' not found", name),
            );
        }
    };

    if webhook.rules.iter().any(|r| r.name == rule.name) {
        return error_response(
            StatusCode::CONFLICT,
            format!("A rule named '{}' already exists", rule.name),
        );
    }

    webhook.rules.push(rule.clone());
    if let Err(e) = state.webhook_database.save_webhooks(&webhook_db) {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save webhooks: {}", e),
        );
    }

    info!("Created rule '{}' for webhook '{}'", rule.name, name);
    json_response(StatusCode::OK, json!({ "success": true, "rule": rule }))
}

#[instrument(skip(state, payload))]
pub async fn update_webhook_rule(
    State(state): State<AppState>,
    Path((name, rule_id)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> Response {
    let mut webhook_db = match state.webhook_database.load_webhooks() {
        Ok(db) => db,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load webhooks: {}", e),
            );
        }
    };

    let webhook = match webhook_db
        .webhooks
        .iter_mut()
        .find(|w| w.path == name || w.name == name)
    {
        Some(w) => w,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Webhook '{}' not found", name),
            );
        }
    };

    let index = match webhook
        .rules
        .iter()
        .position(|r| rule_matches_key(r, &rule_id))
    {
        Some(i) => i,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Rule '{}' not found in webhook", rule_id),
            );
        }
    };

    let mut rule = match parse_rule(&payload) {
        Ok(r) => r,
        Err(e) => return error_response(StatusCode::BAD_REQUEST, e),
    };
    rule.id = webhook.rules[index].id.clone();

    if webhook
        .rules
        .iter()
        .enumerate()
        .any(|(i, r)| i != index && r.name == rule.name)
    {
        return error_response(
            StatusCode::CONFLICT,
            format!("A rule named '{}' already exists", rule.name),
        );
    }

    webhook.rules[index] = rule.clone();

    if let Err(e) = state.webhook_database.save_webhooks(&webhook_db) {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save webhooks: {}", e),
        );
    }

    info!("Updated rule '{}' for webhook '{}'", rule.name, name);
    json_response(StatusCode::OK, json!({ "success": true, "rule": rule }))
}

#[instrument(skip(state))]
pub async fn delete_webhook_rule(
    State(state): State<AppState>,
    Path((name, rule_id)): Path<(String, String)>,
) -> Response {
    let mut webhook_db = match state.webhook_database.load_webhooks() {
        Ok(db) => db,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load webhooks: {}", e),
            );
        }
    };

    let webhook = match webhook_db
        .webhooks
        .iter_mut()
        .find(|w| w.path == name || w.name == name)
    {
        Some(w) => w,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Webhook '{}' not found", name),
            );
        }
    };

    let original_len = webhook.rules.len();
    webhook.rules.retain(|r| !rule_matches_key(r, &rule_id));

    if webhook.rules.len() == original_len {
        return error_response(
            StatusCode::NOT_FOUND,
            format!("Rule '{}' not found in webhook", rule_id),
        );
    }

    if let Err(e) = state.webhook_database.save_webhooks(&webhook_db) {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save webhooks: {}", e),
        );
    }

    info!("Deleted rule '{}' from webhook '{}'", rule_id, name);
    json_response(
        StatusCode::OK,
        json!({
            "success": true,
            "message": format!("Rule '{}' deleted", rule_id),
        }),
    )
}

/// Dry-run endpoint: evaluate rules against a sample payload without
/// executing any actions.
///
/// Body: { "payload": {...}, "rule": {...optional...} }
/// - With "rule": evaluates that (possibly unsaved) rule.
/// - Without: evaluates all of the webhook's rules in order.
#[instrument(skip(state, body))]
pub async fn test_webhook_rules(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let payload = match body.get("payload") {
        Some(p) => p.clone(),
        None => {
            return error_response(
                StatusCode::BAD_REQUEST,
                "Request body must include a 'payload' object".to_string(),
            );
        }
    };

    // Test a single ad-hoc rule
    if let Some(rule_json) = body.get("rule") {
        let rule: WebhookRule = match serde_json::from_value(rule_json.clone()) {
            Ok(r) => r,
            Err(e) => {
                return error_response(StatusCode::BAD_REQUEST, format!("Invalid rule: {}", e));
            }
        };

        let evaluation = evaluate_rule_verbose(&rule, &payload);
        let validation = validate_rule(&rule).err();

        return json_response(
            StatusCode::OK,
            json!({
                "success": true,
                "matched": evaluation.matched,
                "evaluations": [evaluation],
                "validation_error": validation,
            }),
        );
    }

    // Test all rules of the webhook
    let webhook_db = match state.webhook_database.load_webhooks() {
        Ok(db) => db,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load webhooks: {}", e),
            );
        }
    };

    let webhook = match webhook_db
        .webhooks
        .iter()
        .find(|w| w.path == name || w.name == name)
    {
        Some(w) => w,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Webhook '{}' not found", name),
            );
        }
    };

    let evaluations: Vec<_> = webhook
        .rules
        .iter()
        .map(|r| evaluate_rule_verbose(r, &payload))
        .collect();

    let matched_rule = evaluations
        .iter()
        .find(|e| e.matched)
        .map(|e| e.rule_name.clone());

    json_response(
        StatusCode::OK,
        json!({
            "success": true,
            "webhook": webhook.name,
            "matched_rule": matched_rule,
            "evaluations": evaluations,
            "would_display_default": matched_rule.is_none()
                && (webhook.rules.is_empty() || webhook.display_on_no_match
                    || !webhook.default_actions.is_empty()),
        }),
    )
}

/// Reorder a webhook's rules. Rules are evaluated top to bottom and the first
/// match wins, so order is significant.
///
/// Body: { "order": ["<rule id or name>", ...] } — must list every rule once.
#[instrument(skip(state, body))]
pub async fn reorder_webhook_rules(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let order: Vec<String> = match body
        .get("order")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
    {
        Some(o) => o,
        None => {
            return error_response(
                StatusCode::BAD_REQUEST,
                "Request body must include an 'order' array of rule ids".to_string(),
            );
        }
    };

    let mut webhook_db = match state.webhook_database.load_webhooks() {
        Ok(db) => db,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load webhooks: {}", e),
            );
        }
    };

    let webhook = match webhook_db
        .webhooks
        .iter_mut()
        .find(|w| w.path == name || w.name == name)
    {
        Some(w) => w,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Webhook '{}' not found", name),
            );
        }
    };

    let mut remaining = std::mem::take(&mut webhook.rules);
    let mut reordered = Vec::with_capacity(remaining.len());
    for key in &order {
        match remaining.iter().position(|r| rule_matches_key(r, key)) {
            Some(i) => reordered.push(remaining.remove(i)),
            None => {
                // Restore the original rules before bailing out
                reordered.extend(remaining);
                webhook.rules = reordered;
                return error_response(
                    StatusCode::BAD_REQUEST,
                    format!("Rule '{}' not found, or listed more than once", key),
                );
            }
        }
    }
    if !remaining.is_empty() {
        reordered.extend(remaining);
        webhook.rules = reordered;
        return error_response(
            StatusCode::BAD_REQUEST,
            "'order' must include every rule of the webhook".to_string(),
        );
    }
    webhook.rules = reordered;

    if let Err(e) = state.webhook_database.save_webhooks(&webhook_db) {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save webhooks: {}", e),
        );
    }

    info!("Reordered rules for webhook '{}'", name);
    json_response(StatusCode::OK, json!({ "success": true }))
}
