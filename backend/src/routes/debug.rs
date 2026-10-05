//! Admin-only device diagnostics: send a raw command to the connected display.
//!
//! Disabled unless `PXLS_ENABLE_DEBUG=1`. Every POST is admin only through the
//! method rule in `auth::required_role`. While probing, the render loop is held
//! off (via `tool_active_until`) so it does not overwrite what you are looking at.

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;
use std::time::{Duration, Instant};
use tracing::{info, warn};

use crate::device::{frame, mode::Brightness, LightMode};
use crate::AppState;

const MAX_ARGS: usize = 256;
const DEFAULT_HOLD_SECS: u64 = 120;
const MAX_HOLD_SECS: u64 = 900;

pub fn enabled() -> bool {
    matches!(
        std::env::var("PXLS_ENABLE_DEBUG").as_deref(),
        Ok("1") | Ok("true")
    )
}

/// Parse hex like `45 03 0A`, `0x45,0x03` or `45030A` into bytes.
pub fn parse_hex(input: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = input
        .split(|c: char| c.is_whitespace() || c == ',')
        .map(|t| t.trim_start_matches("0x").trim_start_matches("0X"))
        .collect();
    if !cleaned.len().is_multiple_of(2) {
        return Err("hex must have an even number of digits".into());
    }
    (0..cleaned.len())
        .step_by(2)
        .map(|i| {
            cleaned
                .get(i..i + 2)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or_else(|| "invalid hex".to_string())
        })
        .collect()
}

pub async fn status() -> impl IntoResponse {
    Json(json!({ "enabled": enabled() }))
}

#[derive(Debug, Deserialize)]
pub struct SendRequest {
    /// Command byte in hex, e.g. "45".
    pub cmd: String,
    /// Argument bytes in hex, e.g. "03 02". May be empty.
    #[serde(default)]
    pub args: String,
    /// Show solid red first so an ignored command is obvious.
    #[serde(default)]
    pub reset_first: bool,
    /// How long to hold the render loop off, in seconds.
    pub hold_secs: Option<u64>,
}

fn error(status: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(json!({ "error": message })))
}

pub async fn send(
    State(state): State<AppState>,
    Json(req): Json<SendRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    if !enabled() {
        return error(
            StatusCode::FORBIDDEN,
            "Diagnostics are disabled. Set PXLS_ENABLE_DEBUG=1 and restart the backend.",
        );
    }
    let cmd = match parse_hex(&req.cmd) {
        Ok(b) if b.len() == 1 => b[0],
        Ok(_) => return error(StatusCode::BAD_REQUEST, "cmd must be exactly one byte"),
        Err(e) => return error(StatusCode::BAD_REQUEST, &format!("cmd: {e}")),
    };
    let args = match parse_hex(&req.args) {
        Ok(b) if b.len() <= MAX_ARGS => b,
        Ok(_) => return error(StatusCode::BAD_REQUEST, "too many argument bytes (max 256)"),
        Err(e) => return error(StatusCode::BAD_REQUEST, &format!("args: {e}")),
    };

    let hold = req
        .hold_secs
        .unwrap_or(DEFAULT_HOLD_SECS)
        .min(MAX_HOLD_SECS);
    if let Ok(mut until) = state.tool_active_until.lock() {
        *until = Instant::now() + Duration::from_secs(hold);
    }

    let packet = frame::encode(cmd, &args);
    let Ok(mut wrapper) = state.pixoo.lock() else {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to access Pixoo connection",
        );
    };
    let Some(device) = wrapper.get_mut() else {
        return error(StatusCode::CONFLICT, "No device connected");
    };

    if req.reset_first {
        let red = LightMode::Light {
            color: [255, 0, 0],
            brightness: Brightness::from_percent(50),
            effect_mode: crate::device::mode::LightEffectMode::Normal,
            on: true,
        };
        if let Err(e) = device.set_mode(red) {
            warn!(target: "pxls::security", error = %e, "diagnostics reset failed");
            return error(StatusCode::BAD_GATEWAY, &format!("reset failed: {e}"));
        }
        std::thread::sleep(Duration::from_millis(800));
    }

    let hex = hex::encode(&packet);
    info!(target: "pxls::security", hex = %hex, "diagnostics raw send");
    match device.send(cmd, &args) {
        Ok(()) => (
            StatusCode::OK,
            Json(json!({ "success": true, "sent": hex, "hold_secs": hold })),
        ),
        Err(e) => error(StatusCode::BAD_GATEWAY, &format!("send failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Method;

    #[test]
    fn parses_common_hex_forms() {
        assert_eq!(parse_hex("45 03 0A").unwrap(), [0x45, 0x03, 0x0A]);
        assert_eq!(parse_hex("0x45,0x03").unwrap(), [0x45, 0x03]);
        assert_eq!(parse_hex("45030a").unwrap(), [0x45, 0x03, 0x0A]);
        assert_eq!(parse_hex("").unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn rejects_bad_hex() {
        assert!(parse_hex("4").is_err());
        assert!(parse_hex("zz").is_err());
    }

    #[test]
    fn sending_requires_admin() {
        assert_eq!(
            crate::auth::required_role(&Method::POST, "/api/debug/send"),
            crate::database::accounts::Role::Admin
        );
    }
}
