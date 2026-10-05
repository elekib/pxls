use axum::{
    extract::State,
    http::{header, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use std::time::{Duration, Instant};
use tracing::{info, instrument, warn};

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct BuzzerRequest {
    #[serde(default = "default_active_time")]
    pub active_time: u32,
    #[serde(default = "default_off_time")]
    pub off_time: u32,
    #[serde(default = "default_total_time")]
    pub total_time: u32,
}

fn default_active_time() -> u32 {
    500
}
fn default_off_time() -> u32 {
    0
}
fn default_total_time() -> u32 {
    1000
}

#[derive(Debug, Deserialize)]
pub struct CountdownRequest {
    pub minutes: u8,
    pub seconds: u8,
}

#[derive(Debug, Deserialize)]
pub struct ScoreboardRequest {
    pub red_score: u8,
    pub blue_score: u8,
}

#[instrument(skip(state))]
pub async fn set_scoreboard(
    State(state): State<AppState>,
    Json(req): Json<ScoreboardRequest>,
) -> Response {
    // Set tool active BEFORE sending the scoreboard command. The scoreboard
    // wrapper drops and reconnects the Bluetooth connection; without this
    // ordering, the rendering loop would see no connection + no active tool
    // during that window and call try_reconnect, racing the scoreboard command
    // and producing garbage on screen.
    if let Ok(mut tool_until) = state.tool_active_until.lock() {
        *tool_until = Instant::now() + Duration::from_secs(86400);
    }
    if let Ok(mut tool_type) = state.active_tool_type.lock() {
        *tool_type = Some("scoreboard".to_string());
    }

    match state.pixoo.lock() {
        Ok(mut wrapper) => {
            match wrapper.set_scoreboard(req.red_score, req.blue_score) {
                Ok(_) => {
                    info!(
                        "Scoreboard set: Red={}, Blue={}",
                        req.red_score, req.blue_score
                    );
                    let success = json!({
                        "success": true,
                        "message": format!("Scoreboard set: Red={} Blue={}", req.red_score, req.blue_score),
                        "red_score": req.red_score,
                        "blue_score": req.blue_score
                    });
                    Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(success.to_string().into())
                        .unwrap()
                }
                Err(e) => {
                    warn!(error = %e, "Failed to set scoreboard");
                    // Clear tool active on failure so the rendering loop resumes
                    if let Ok(mut tool_until) = state.tool_active_until.lock() {
                        *tool_until = Instant::now();
                    }
                    if let Ok(mut tool_type) = state.active_tool_type.lock() {
                        *tool_type = None;
                    }
                    let error = json!({
                        "error": format!("Failed to set scoreboard: {}", e)
                    });
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(error.to_string().into())
                        .unwrap()
                }
            }
        }
        Err(_) => {
            let error = json!({"error": "Failed to access Pixoo connection"});
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(error.to_string().into())
                .unwrap()
        }
    }
}

#[instrument(skip(state))]
pub async fn start_countdown(
    State(state): State<AppState>,
    Json(req): Json<CountdownRequest>,
) -> Response {
    match state.pixoo.lock() {
        Ok(mut wrapper) => {
            match wrapper.start_countdown(req.minutes, req.seconds) {
                Ok(_) => {
                    info!("Countdown started: {}m {}s", req.minutes, req.seconds);
                    // Set tool active until countdown completes plus 5 second buffer
                    let duration_secs = (req.minutes as u64 * 60) + (req.seconds as u64) + 5;
                    if let Ok(mut tool_until) = state.tool_active_until.lock() {
                        *tool_until = Instant::now() + Duration::from_secs(duration_secs);
                    }
                    let success = json!({
                        "success": true,
                        "message": format!("Countdown started: {}m {}s", req.minutes, req.seconds)
                    });
                    Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(success.to_string().into())
                        .unwrap()
                }
                Err(e) => {
                    warn!(error = %e, "Failed to start countdown");
                    let error = json!({
                        "error": format!("Failed to start countdown: {}", e)
                    });
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(error.to_string().into())
                        .unwrap()
                }
            }
        }
        Err(_) => {
            let error = json!({"error": "Failed to access Pixoo connection"});
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(error.to_string().into())
                .unwrap()
        }
    }
}

#[instrument(skip(state))]
pub async fn start_sound_detector(State(state): State<AppState>) -> Response {
    match state.pixoo.lock() {
        Ok(mut wrapper) => {
            match wrapper.start_sound_detector() {
                Ok(_) => {
                    info!("Sound detector started");
                    // Set tool active for 5 minutes
                    if let Ok(mut tool_until) = state.tool_active_until.lock() {
                        *tool_until = Instant::now() + Duration::from_secs(300);
                    }
                    let success = json!({
                        "success": true,
                        "message": "Sound detector started (5 min)"
                    });
                    Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(success.to_string().into())
                        .unwrap()
                }
                Err(e) => {
                    warn!(error = %e, "Failed to start sound detector");
                    let error = json!({
                        "error": format!("Failed to start sound detector: {}", e)
                    });
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(error.to_string().into())
                        .unwrap()
                }
            }
        }
        Err(_) => {
            let error = json!({"error": "Failed to access Pixoo connection"});
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(error.to_string().into())
                .unwrap()
        }
    }
}

#[instrument(skip(state))]
pub async fn play_buzzer(
    State(state): State<AppState>,
    Json(req): Json<BuzzerRequest>,
) -> Response {
    match state.pixoo.lock() {
        Ok(mut wrapper) => {
            let active_time = req.active_time as u16;
            let off_time = req.off_time as u16;
            let total_time = req.total_time as u16;
            match wrapper.play_buzzer(active_time, off_time, total_time) {
                Ok(_) => {
                    info!("Buzzer activated successfully");
                    let success = json!({
                        "success": true,
                        "message": "Buzzer activated",
                        "duration_ms": 1000
                    });
                    Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(success.to_string().into())
                        .unwrap()
                }
                Err(e) => {
                    warn!(error = %e, "Failed to send buzzer command");
                    let error = json!({
                        "error": format!("Failed to send buzzer command: {}", e)
                    });
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(error.to_string().into())
                        .unwrap()
                }
            }
        }
        Err(_) => {
            let error = json!({"error": "Failed to access Pixoo connection"});
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(error.to_string().into())
                .unwrap()
        }
    }
}

#[instrument(skip(state))]
pub async fn stop_tool(State(state): State<AppState>) -> Response {
    use std::sync::atomic::Ordering;

    // Clear the tool active timer
    if let Ok(mut tool_until) = state.tool_active_until.lock() {
        *tool_until = Instant::now();
        info!("Tool mode stopped by user, allowing reconnection");
    }

    // Clear active tool type
    if let Ok(mut tool_type) = state.active_tool_type.lock() {
        *tool_type = None;
    }

    // Trigger reconnect
    state.should_reconnect.store(true, Ordering::SeqCst);

    let success = json!({
        "success": true,
        "message": "Tool stopped, reconnecting to device"
    });
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(success.to_string().into())
        .unwrap()
}
