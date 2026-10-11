use axum::{
    extract::State,
    http::{header, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tracing::{info, instrument, warn};

use crate::pixoo_wrapper::{self, ToolLink};
use crate::tool_state::ToolKind;
use crate::AppState;

/// The noise meter has no end of its own; this is how long the UI treats it as
/// running before the display goes back to the configured mode.
const SOUND_DETECTOR_SECS: u64 = 300;

#[derive(Debug, Deserialize)]
pub struct CountdownRequest {
    pub minutes: u8,
    pub seconds: u8,
}

#[derive(Debug, Deserialize)]
pub struct ScoreboardRequest {
    pub red_score: u16,
    pub blue_score: u16,
}

fn json_response(status: StatusCode, body: Value) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.to_string().into())
        .unwrap()
}

fn ok(body: Value) -> Response {
    json_response(StatusCode::OK, body)
}

fn fail(status: StatusCode, msg: String) -> Response {
    json_response(status, json!({ "error": msg }))
}

/// Run blocking Bluetooth work off the async worker threads.
async fn blocking<R: Send + 'static>(f: impl FnOnce() -> R + Send + 'static) -> Result<R, String> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("device task failed: {e}"))
}

/// Record the tool BEFORE sending so the render loop never sees a gap, run
/// `send` on the open link, and forget the tool again if sending fails.
async fn start_tool(
    state: &AppState,
    kind: ToolKind,
    duration: Option<Duration>,
    send: impl FnOnce(&mut crate::device::Pixoo) -> anyhow::Result<()> + Send + 'static,
) -> Result<(), String> {
    if let Ok(mut tool) = state.tool.lock() {
        tool.begin(kind, duration);
    }
    let pixoo = state.pixoo.clone();
    let result = blocking(move || match pixoo.lock() {
        Ok(mut wrapper) => wrapper.with_link(send),
        Err(_) => Err(anyhow::anyhow!("Failed to access Pixoo connection")),
    })
    .await
    .and_then(|r| r.map_err(|e| e.to_string()));
    if result.is_err() {
        if let Ok(mut tool) = state.tool.lock() {
            tool.end();
        }
    }
    result
}

#[instrument(skip(state))]
pub async fn set_scoreboard(
    State(state): State<AppState>,
    Json(req): Json<ScoreboardRequest>,
) -> Response {
    let (red, blue) = (req.red_score, req.blue_score);
    match start_tool(&state, ToolKind::Scoreboard, None, move |p| {
        pixoo_wrapper::set_score(p, red, blue)
    })
    .await
    {
        Ok(()) => {
            info!(red, blue, "Scoreboard set");
            ok(json!({
                "success": true,
                "message": format!("Scoreboard set: Red={red} Blue={blue}"),
                "red_score": red,
                "blue_score": blue
            }))
        }
        Err(e) => {
            warn!(error = %e, "Failed to set scoreboard");
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to set scoreboard: {e}"),
            )
        }
    }
}

#[instrument(skip(state))]
pub async fn start_countdown(
    State(state): State<AppState>,
    Json(req): Json<CountdownRequest>,
) -> Response {
    let total = req.minutes as u64 * 60 + req.seconds as u64;
    if total == 0 {
        return fail(
            StatusCode::BAD_REQUEST,
            "Countdown must be longer than 0 seconds".into(),
        );
    }
    let (minutes, seconds) = (req.minutes, req.seconds);
    let link = ToolLink::from_env();
    match start_tool(
        &state,
        ToolKind::Countdown,
        Some(Duration::from_secs(total)),
        move |p| pixoo_wrapper::start_countdown(p, minutes, seconds, link),
    )
    .await
    {
        Ok(()) => {
            info!("Countdown started: {minutes}m {seconds}s");
            ok(json!({
                "success": true,
                "message": format!("Countdown started: {minutes}m {seconds}s")
            }))
        }
        Err(e) => {
            warn!(error = %e, "Failed to start countdown");
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to start countdown: {e}"),
            )
        }
    }
}

#[instrument(skip(state))]
pub async fn start_sound_detector(State(state): State<AppState>) -> Response {
    let link = ToolLink::from_env();
    match start_tool(
        &state,
        ToolKind::SoundDetector,
        Some(Duration::from_secs(SOUND_DETECTOR_SECS)),
        move |p| pixoo_wrapper::start_sound_detector(p, link),
    )
    .await
    {
        Ok(()) => {
            info!("Sound detector started");
            ok(json!({ "success": true, "message": "Sound detector started (5 min)" }))
        }
        Err(e) => {
            warn!(error = %e, "Failed to start sound detector");
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to start sound detector: {e}"),
            )
        }
    }
}

#[instrument(skip(state))]
pub async fn stop_tool(State(state): State<AppState>) -> Response {
    let kind = state.tool.lock().ok().and_then(|mut t| {
        let kind = t.kind();
        t.end();
        kind
    });
    let Some(kind) = kind else {
        return ok(json!({ "success": true, "message": "No tool running" }));
    };
    info!(tool = kind.as_str(), "Tool stopped by user");

    // Put the display back on the same link, at once. If the link is closed
    // (fallback mode, or a dropped connection) the render loop reconnects.
    let device_config = state.config.lock().unwrap().device_config.clone();
    let pixoo = state.pixoo.clone();
    let result = blocking(move || match pixoo.lock() {
        Ok(mut wrapper) => {
            wrapper.with_link(|p| pixoo_wrapper::end_tool(p, kind, true, &device_config))
        }
        Err(_) => Err(anyhow::anyhow!("Failed to access Pixoo connection")),
    })
    .await;
    match result {
        Ok(Ok(())) => ok(json!({ "success": true, "message": "Tool stopped" })),
        Ok(Err(e)) => {
            warn!(error = %e, "Could not restore the display on the open link, reconnecting");
            state.should_reconnect.store(true, Ordering::SeqCst);
            ok(json!({ "success": true, "message": "Tool stopped, reconnecting to device" }))
        }
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}
