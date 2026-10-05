use axum::{
    extract::{Path, State},
    Json,
    response::Response,
    http::{StatusCode, header},
};
use serde_json::{json, Value};
use tracing::{info, warn, instrument};
use uuid::Uuid;

use crate::AppState;
use crate::webhook_enhanced::{
    WebhookEvent, WebhookAction, DisplayDefaults,
    evaluate_rule, default_display_action,
};

/// Upper bound for an action's `delay_ms`, so one rule can't hold a request open for long.
const MAX_ACTION_DELAY_MS: u64 = 15_000;

struct WebhookOutcome {
    status: StatusCode,
    processed: bool,
    matched_rule: Option<String>,
    actions_taken: Vec<String>,
    message: String,
    error: Option<String>,
    log_event: bool,
    max_events: usize,
}

impl WebhookOutcome {
    fn new(status: StatusCode, processed: bool, message: String) -> Self {
        Self {
            status,
            processed,
            matched_rule: None,
            actions_taken: Vec::new(),
            message,
            error: None,
            log_event: true,
            max_events: 100,
        }
    }
}

#[instrument(skip(state, payload))]
pub async fn handle_webhook(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(payload): Json<Value>,
) -> Response {
    info!(webhook_name = %name, "Received webhook");
    ingest_webhook(&state, &name, payload).await
}

/// Process a payload for a webhook, log the resulting event and build the
/// HTTP response. Shared by live deliveries and event replays.
pub async fn ingest_webhook(state: &AppState, name: &str, payload: Value) -> Response {
    let name = name.to_string();
    let state = state.clone();
    let event_id = Uuid::new_v4().to_string();
    let outcome = process_webhook(&state, &name, &payload).await;

    // Record the event with its final processing state
    let event = WebhookEvent {
        id: event_id.clone(),
        webhook_name: name.clone(),
        timestamp: chrono::Utc::now(),
        payload: payload.clone(),
        processed: outcome.processed,
        actions_taken: outcome.actions_taken.clone(),
        error: outcome.error.clone(),
        matched_rule: outcome.matched_rule.clone(),
    };

    if outcome.log_event {
        if let Err(e) = state.webhook_database.log_event(event, outcome.max_events) {
            warn!("Failed to persist webhook event: {}", e);
        }
    }

    let success = outcome.status.is_success();
    let mut body = json!({
        "success": success,
        "processed": outcome.processed,
        "message": outcome.message,
        "event_id": event_id,
        "actions_taken": outcome.actions_taken,
        "webhook_name": name,
    });
    if let Some(rule) = &outcome.matched_rule {
        body["matched_rule"] = json!(rule);
    }
    if let Some(err) = &outcome.error {
        body["error"] = json!(err);
    }

    Response::builder()
        .status(outcome.status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.to_string().into())
        .unwrap()
}

async fn run_actions(
    state: &AppState,
    actions: &[WebhookAction],
    payload: &Value,
    defaults: &DisplayDefaults,
) -> (Vec<String>, Option<String>) {
    let mut actions_taken = Vec::new();
    let mut failures = Vec::new();

    for action in actions {
        // Optional pause so a later action can follow an earlier one on the
        // single-slot display (e.g. a "DONE" label, then the poster)
        if let Some(delay_ms) = action.parameters.get("delay_ms").and_then(|v| v.as_u64()) {
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms.min(MAX_ACTION_DELAY_MS))).await;
        }
        match state.action_executor.execute_action(action, payload, defaults).await {
            Ok(result) => actions_taken.push(result),
            Err(e) => {
                let msg = format!("{:?} action failed: {}", action.action_type, e);
                actions_taken.push(format!("Action failed: {}", e));
                failures.push(msg);
            }
        }
    }

    let error = if failures.is_empty() { None } else { Some(failures.join("; ")) };
    (actions_taken, error)
}

async fn process_webhook(state: &AppState, name: &str, payload: &Value) -> WebhookOutcome {
    // --- Enhanced webhook path (rules engine) ---
    match state.webhook_database.load_webhooks() {
        Ok(db) => {
            if let Some(webhook) = db.webhooks.iter().find(|w| w.path == name || w.name == name) {
                let mut outcome = WebhookOutcome::new(
                    StatusCode::OK,
                    false,
                    String::new(),
                );
                outcome.log_event = webhook.log_events;
                outcome.max_events = webhook.max_events.max(1);

                if !webhook.enabled {
                    outcome.message = format!("Webhook '{}' is disabled", webhook.name);
                    return outcome;
                }

                let defaults = DisplayDefaults::from(webhook);

                // Evaluate rules in order; first match wins
                if let Some(rule) = webhook.rules.iter().find(|r| evaluate_rule(r, payload)) {
                    let (actions, error) = run_actions(state, &rule.actions, payload, &defaults).await;
                    outcome.actions_taken = actions;
                    outcome.error = error;
                    outcome.processed = true;
                    outcome.matched_rule = Some(rule.name.clone());
                    outcome.message = format!("Matched rule '{}'", rule.name);
                    return outcome;
                }

                // No rule matched: explicit default actions take precedence
                if !webhook.default_actions.is_empty() {
                    let (actions, error) = run_actions(state, &webhook.default_actions, payload, &defaults).await;
                    outcome.actions_taken = actions;
                    outcome.error = error;
                    outcome.processed = true;
                    outcome.message = "No rules matched; ran default actions".to_string();
                    return outcome;
                }

                // Implicit default display: always used when the webhook has no
                // rules; when rules exist, only if display_on_no_match is set
                if webhook.rules.is_empty() || webhook.display_on_no_match {
                    match default_display_action(&defaults) {
                        Some(action) => {
                            let (actions, error) = run_actions(state, &[action], payload, &defaults).await;
                            outcome.actions_taken = actions;
                            outcome.error = error;
                            outcome.processed = true;
                            outcome.message = "Processed with default display settings".to_string();
                        }
                        None => {
                            outcome.message =
                                "No rules matched and image display mode requires image_url_field"
                                    .to_string();
                        }
                    }
                } else {
                    outcome.message = "No rules matched".to_string();
                }
                return outcome;
            }
        }
        Err(e) => {
            warn!("Failed to load enhanced webhooks database: {}", e);
        }
    }

    // --- Legacy config fallback (unmigrated webhooks in config.json) ---
    let webhook_config = {
        let config = match state.config.lock() {
            Ok(cfg) => cfg,
            Err(_) => {
                let mut outcome = WebhookOutcome::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    false,
                    "Failed to access config".to_string(),
                );
                outcome.error = Some("Failed to access config".to_string());
                return outcome;
            }
        };
        config.webhooks.iter()
            .find(|w| w.name == name || w.path == name)
            .cloned()
    };

    match webhook_config {
        Some(webhook) => {
            let mut outcome = WebhookOutcome::new(StatusCode::OK, false, String::new());
            if !webhook.enabled {
                outcome.message = format!("Webhook '{}' is disabled", webhook.name);
                return outcome;
            }

            let defaults = DisplayDefaults::from(&webhook);
            match default_display_action(&defaults) {
                Some(action) => {
                    let (actions, error) = run_actions(state, &[action], payload, &defaults).await;
                    outcome.actions_taken = actions;
                    outcome.error = error;
                    outcome.processed = true;
                    outcome.message = "Processed with legacy display settings".to_string();
                }
                None => {
                    outcome.status = StatusCode::BAD_REQUEST;
                    outcome.error = Some(
                        "Image display mode requires image_url_field to be configured".to_string(),
                    );
                    outcome.message = outcome.error.clone().unwrap();
                }
            }
            outcome
        }
        None => {
            let mut outcome = WebhookOutcome::new(
                StatusCode::NOT_FOUND,
                false,
                format!("Webhook '{}' not found in configuration", name),
            );
            outcome.error = Some(outcome.message.clone());
            outcome
        }
    }
}
