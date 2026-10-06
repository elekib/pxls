use axum::{
    body::Bytes,
    extract::{Path, RawQuery, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
};
use serde_json::{json, Value};
use tracing::{info, instrument, warn};
use uuid::Uuid;

use crate::webhook_enhanced::{
    default_display_action, evaluate_rule, DisplayDefaults, WebhookAction, WebhookEvent,
};
use crate::AppState;

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

fn json_error(status: StatusCode, message: &str) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({ "success": false, "error": message })
                .to_string()
                .into(),
        )
        .unwrap()
}

/// Receive a webhook from an external sender. The sender authenticates with the
/// webhook's own secret; unknown webhooks and wrong secrets get the same 401 so
/// callers cannot probe which webhook names exist.
#[instrument(skip(state, headers, query, body))]
pub async fn handle_webhook(
    State(state): State<AppState>,
    Path(name): Path<String>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Response {
    let provided = crate::auth::extract_webhook_secret(&headers, query.as_deref());
    let authorized = match state.webhook_database.load_webhooks() {
        Ok(db) => db
            .webhooks
            .iter()
            .find(|w| w.path == name || w.name == name)
            .is_some_and(|w| crate::auth::webhook_secret_ok(&w.secret, provided.as_deref())),
        Err(e) => {
            warn!("Failed to load webhooks for authentication: {}", e);
            false
        }
    };
    if !authorized {
        warn!(webhook_name = %name, "Rejected webhook: unknown webhook or missing/invalid secret");
        return json_error(StatusCode::UNAUTHORIZED, "Unauthorized");
    }

    let payload: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Request body must be valid JSON"),
    };
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
            tokio::time::sleep(std::time::Duration::from_millis(
                delay_ms.min(MAX_ACTION_DELAY_MS),
            ))
            .await;
        }
        match state
            .action_executor
            .execute_action(action, payload, defaults)
            .await
        {
            Ok(result) => actions_taken.push(result),
            Err(e) => {
                let msg = format!("{:?} action failed: {}", action.action_type, e);
                actions_taken.push(format!("Action failed: {e}"));
                failures.push(msg);
            }
        }
    }

    let error = if failures.is_empty() {
        None
    } else {
        Some(failures.join("; "))
    };
    (actions_taken, error)
}

async fn process_webhook(state: &AppState, name: &str, payload: &Value) -> WebhookOutcome {
    // --- Enhanced webhook path (rules engine) ---
    match state.webhook_database.load_webhooks() {
        Ok(db) => {
            if let Some(webhook) = db
                .webhooks
                .iter()
                .find(|w| w.path == name || w.name == name)
            {
                let mut outcome = WebhookOutcome::new(StatusCode::OK, false, String::new());
                outcome.log_event = webhook.log_events;
                outcome.max_events = webhook.max_events.max(1);

                if !webhook.enabled {
                    outcome.message = format!("Webhook '{}' is disabled", webhook.name);
                    return outcome;
                }

                let defaults = DisplayDefaults::from(webhook);

                // Evaluate rules in order; first match wins
                if let Some(rule) = webhook.rules.iter().find(|r| evaluate_rule(r, payload)) {
                    let (actions, error) =
                        run_actions(state, &rule.actions, payload, &defaults).await;
                    outcome.actions_taken = actions;
                    outcome.error = error;
                    outcome.processed = true;
                    outcome.matched_rule = Some(rule.name.clone());
                    outcome.message = format!("Matched rule '{}'", rule.name);
                    return outcome;
                }

                // No rule matched: explicit default actions take precedence
                if !webhook.default_actions.is_empty() {
                    let (actions, error) =
                        run_actions(state, &webhook.default_actions, payload, &defaults).await;
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
                            let (actions, error) =
                                run_actions(state, &[action], payload, &defaults).await;
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
        config
            .webhooks
            .iter()
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
                format!("Webhook '{name}' not found in configuration"),
            );
            outcome.error = Some(outcome.message.clone());
            outcome
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::ActionExecutor;
    use crate::config::Config;
    use crate::database::WebhookDatabase;
    use crate::notification::NotificationManager;
    use crate::pixoo_wrapper::PixooWrapper;
    use crate::token_manager::TokenManager;
    use crate::webhook_image_processor::WebhookImageProcessor;
    use axum::{routing::post, Router};
    use base64::Engine;
    use std::sync::{atomic::AtomicBool, Arc, Mutex};

    const SECRET: &str = "0123456789abcdef0123456789abcdef";

    /// Serve the real webhook receiver on a random port with one disabled webhook
    /// ("radarr"), so a request that passes authentication returns without touching a device.
    async fn serve() -> (String, std::path::PathBuf) {
        let dir =
            std::env::temp_dir().join(format!("pxls-webhook-test-{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let webhook = json!({
            "name": "radarr", "enabled": false, "path": "radarr", "secret": SECRET,
            "log_events": false, "max_events": 10, "rules": [], "default_actions": [],
            "duration_secs": 5, "display_mode": "icon_only", "background_color": "FF0000",
            "text_color": "FFFFFF", "title_field": "title", "subtitle_field": "subtitle",
            "flash": false, "flash_speed_ms": 500, "icon": "x", "icon_image_url": "",
            "image_url_field": ""
        });
        std::fs::write(
            dir.join("webhooks.json"),
            json!({ "webhooks": [webhook] }).to_string(),
        )
        .unwrap();

        let config = Arc::new(Mutex::new(Config::default()));
        let pixoo = Arc::new(Mutex::new(PixooWrapper::new()));
        let notification_manager = NotificationManager::new();
        let processor = Arc::new(tokio::sync::Mutex::new(WebhookImageProcessor::new()));
        let state = crate::AppState {
            config: config.clone(),
            pixoo: pixoo.clone(),
            should_reconnect: Arc::new(AtomicBool::new(false)),
            manual_disconnect: Arc::new(AtomicBool::new(false)),
            tool: Arc::new(Mutex::new(crate::tool_state::ToolTimer::default())),
            notification_manager: notification_manager.clone(),
            webhook_image_processor: processor.clone(),
            webhook_database: Arc::new(WebhookDatabase::new(dir.to_str().unwrap())),
            action_executor: Arc::new(ActionExecutor::new(notification_manager, processor, pixoo)),
            token_manager: Arc::new(TokenManager::new(config)),
        };
        let app = Router::new()
            .route("/api/webhook/:name", post(handle_webhook))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, dir)
    }

    async fn post_status(url: String, headers: &[(&str, String)], body: &str) -> u16 {
        let mut req = reqwest::Client::new()
            .post(url)
            .header("content-type", "application/json")
            .body(body.to_string());
        for (k, v) in headers {
            req = req.header(*k, v);
        }
        req.send().await.unwrap().status().as_u16()
    }

    #[tokio::test]
    async fn webhook_requires_the_webhook_secret() {
        let (base, dir) = serve().await;
        let url = format!("{base}/api/webhook/radarr");
        let body = r#"{"eventType":"Download"}"#;

        // No secret, wrong secret, and an unknown webhook are all the same 401.
        assert_eq!(post_status(url.clone(), &[], body).await, 401);
        assert_eq!(
            post_status(url.clone(), &[("x-webhook-secret", "wrong".into())], body).await,
            401
        );
        assert_eq!(
            post_status(format!("{url}?secret=wrong"), &[], body).await,
            401
        );
        assert_eq!(
            post_status(
                format!("{base}/api/webhook/nope"),
                &[("x-webhook-secret", SECRET.into())],
                body
            )
            .await,
            401
        );

        // Correct secret by header, query string and Basic auth passes authentication.
        assert_eq!(
            post_status(url.clone(), &[("x-webhook-secret", SECRET.into())], body).await,
            200
        );
        assert_eq!(
            post_status(format!("{url}?secret={SECRET}"), &[], body).await,
            200
        );
        let basic = base64::engine::general_purpose::STANDARD.encode(format!("radarr:{SECRET}"));
        assert_eq!(
            post_status(
                url.clone(),
                &[("authorization", format!("Basic {basic}"))],
                body
            )
            .await,
            200
        );

        // Authenticated but not JSON.
        assert_eq!(
            post_status(url, &[("x-webhook-secret", SECRET.into())], "not json").await,
            400
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
