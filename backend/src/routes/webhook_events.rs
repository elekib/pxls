use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::Response,
};
use serde::Deserialize;
use serde_json::json;
use tracing::instrument;

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct WebhookEventsQuery {
    pub webhook_name: Option<String>,
    pub limit: Option<usize>,
}

#[instrument(skip(state))]
pub async fn get_webhook_events(
    State(state): State<AppState>,
    Query(query): Query<WebhookEventsQuery>,
) -> Response {
    match state
        .webhook_database
        .get_events(query.webhook_name, query.limit)
    {
        Ok(events) => {
            let response = json!({
                "success": true,
                "events": events,
                "count": events.len()
            });
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(response.to_string().into())
                .unwrap()
        }
        Err(e) => {
            let error = json!({
                "success": false,
                "error": format!("Failed to load events: {}", e)
            });
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(error.to_string().into())
                .unwrap()
        }
    }
}

#[instrument(skip(state))]
pub async fn clear_webhook_events(
    State(state): State<AppState>,
    Path(webhook_name): Path<String>,
) -> Response {
    let result = state
        .webhook_database
        .clear_events(Some(webhook_name.clone()));

    let (status, body) = match result {
        Ok(_) => (
            StatusCode::OK,
            json!({
                "success": true,
                "message": format!("Events cleared for webhook: {}", webhook_name)
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "success": false, "error": format!("Failed to clear events: {}", e) }),
        ),
    };

    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.to_string().into())
        .unwrap()
}

#[instrument(skip(state))]
pub async fn clear_all_webhook_events(State(state): State<AppState>) -> Response {
    let result = state.webhook_database.clear_events(None);

    let (status, body) = match result {
        Ok(_) => (
            StatusCode::OK,
            json!({ "success": true, "message": "All webhook events cleared" }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "success": false, "error": format!("Failed to clear events: {}", e) }),
        ),
    };

    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.to_string().into())
        .unwrap()
}

/// Per-webhook delivery summary used by the management UI.
#[instrument(skip(state))]
pub async fn get_webhook_events_summary(State(state): State<AppState>) -> Response {
    let events = match state.webhook_database.get_events(None, None) {
        Ok(events) => events,
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load events: {}", e),
            );
        }
    };

    // Events are stored oldest-first or newest-first depending on the store,
    // so pick the latest by timestamp rather than relying on order.
    let mut summary: std::collections::BTreeMap<String, serde_json::Value> = Default::default();
    for event in &events {
        let entry = summary
            .entry(event.webhook_name.clone())
            .or_insert_with(|| {
                json!({ "count": 0, "error_count": 0, "last_timestamp": null,
                    "last_processed": null, "last_error": null, "last_matched_rule": null })
            });
        entry["count"] = json!(entry["count"].as_u64().unwrap_or(0) + 1);
        if event.error.is_some() {
            entry["error_count"] = json!(entry["error_count"].as_u64().unwrap_or(0) + 1);
        }
        let is_newer = entry["last_timestamp"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .is_none_or(|t| event.timestamp > t.with_timezone(&chrono::Utc));
        if is_newer {
            entry["last_timestamp"] = json!(event.timestamp);
            entry["last_processed"] = json!(event.processed);
            entry["last_error"] = json!(event.error);
            entry["last_matched_rule"] = json!(event.matched_rule);
        }
    }

    json_ok(json!({ "success": true, "summary": summary }))
}

/// Re-run a logged event's payload through its webhook as a new delivery.
#[instrument(skip(state))]
pub async fn replay_webhook_event(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
) -> Response {
    let events = match state.webhook_database.get_events(None, None) {
        Ok(events) => events,
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load events: {}", e),
            );
        }
    };

    match events.into_iter().find(|e| e.id == event_id) {
        Some(event) => {
            crate::routes::webhooks::ingest_webhook(&state, &event.webhook_name, event.payload)
                .await
        }
        None => json_error(
            StatusCode::NOT_FOUND,
            format!("Event '{}' not found", event_id),
        ),
    }
}

fn json_ok(body: serde_json::Value) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.to_string().into())
        .unwrap()
}

fn json_error(status: StatusCode, message: String) -> Response {
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
