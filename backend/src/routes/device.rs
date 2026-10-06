use axum::{
    extract::State,
    http::{header, StatusCode},
    response::Response,
    Json,
};
use bluetooth_serial_port::BtAddr;
use serde::Deserialize;
use serde_json::json;
use std::str::FromStr;
use std::sync::atomic::Ordering;
use tracing::{error, info, instrument};

use crate::config::DeviceConfig;
use crate::device::Pixoo;
use crate::rendering::device_config::apply_device_config;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct ConnectRequest {
    pub mac: String,
}

#[instrument(skip(state))]
pub async fn connect_device(
    State(state): State<AppState>,
    Json(req): Json<ConnectRequest>,
) -> Response {
    match BtAddr::from_str(&req.mac) {
        Ok(bt_addr) => {
            // Bluetooth connect blocks, so keep it off the async worker threads.
            let device_config = {
                let cfg = state.config.lock().unwrap();
                cfg.device_config.clone()
            };
            let connected = tokio::task::spawn_blocking(move || {
                Pixoo::connect(bt_addr).map(|mut new_pixoo| {
                    if let Err(e) = apply_device_config(&mut new_pixoo, &device_config) {
                        error!(error = %e, "Failed to apply device configuration during connection");
                    }
                    new_pixoo
                })
            })
            .await
            .unwrap_or_else(|e| Err(crate::device::DeviceError::Connect(e.to_string())));
            match connected {
                Ok(new_pixoo) => {
                    // A fresh link has no tool running on it.
                    if let Ok(mut tool) = state.tool.lock() {
                        tool.end();
                    }

                    match state.pixoo.lock() {
                        Ok(mut wrapper) => {
                            wrapper.replace(new_pixoo);

                            if let Ok(mut cfg) = state.config.lock() {
                                cfg.pixoo_mac = req.mac.clone();
                                let _ = cfg.save();
                            }

                            // Clear manual disconnect flag
                            state.manual_disconnect.store(false, Ordering::SeqCst);

                            let success = json!({
                                "success": true,
                                "message": format!("Successfully connected to device {}", req.mac)
                            });
                            Response::builder()
                                .status(StatusCode::OK)
                                .header(header::CONTENT_TYPE, "application/json")
                                .body(success.to_string().into())
                                .unwrap()
                        }
                        Err(_) => {
                            let error = json!({"error": "Failed to update Pixoo connection"});
                            Response::builder()
                                .status(StatusCode::INTERNAL_SERVER_ERROR)
                                .header(header::CONTENT_TYPE, "application/json")
                                .body(error.to_string().into())
                                .unwrap()
                        }
                    }
                }
                Err(e) => {
                    let error = json!({"error": format!("Failed to connect to device: {}", e)});
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(error.to_string().into())
                        .unwrap()
                }
            }
        }
        Err(_) => {
            let error = json!({"error": "Invalid MAC address format"});
            Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header(header::CONTENT_TYPE, "application/json")
                .body(error.to_string().into())
                .unwrap()
        }
    }
}

#[instrument(skip(state))]
pub async fn disconnect_device(State(state): State<AppState>) -> Response {
    // Clear the connection
    if let Ok(mut wrapper) = state.pixoo.lock() {
        *wrapper = crate::pixoo_wrapper::PixooWrapper::new();
    }

    // Set manual disconnect flag to prevent auto-reconnect
    state.manual_disconnect.store(true, Ordering::SeqCst);

    info!("Device manually disconnected");

    let success = json!({
        "success": true,
        "message": "Device disconnected. You can now use the Divoom app. Click 'Connect' to reconnect."
    });
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(success.to_string().into())
        .unwrap()
}

#[instrument(skip(state))]
pub async fn connection_status(State(state): State<AppState>) -> Response {
    let is_connected = {
        let wrapper = state.pixoo.lock().unwrap();
        wrapper.get().is_some()
    };

    let manual_disconnect = state.manual_disconnect.load(Ordering::SeqCst);

    // Tool state: kind of the running tool (null when none or expired) and the
    // seconds left (null for tools without a timer, such as the scoreboard).
    let (tool_type, tool_remaining_secs) = {
        let tool = state.tool.lock().unwrap();
        (
            tool.kind().map(|k| k.as_str()),
            tool.remaining().map(|d| d.as_secs_f64().ceil() as u64),
        )
    };

    let status = json!({
        "connected": is_connected,
        "manual_disconnect": manual_disconnect,
        "tool_type": tool_type,
        "tool_remaining_secs": tool_remaining_secs
    });

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(status.to_string().into())
        .unwrap()
}

#[instrument(skip(state))]
pub async fn update_device_config(
    State(state): State<AppState>,
    Json(device_config): Json<DeviceConfig>,
) -> Response {
    // Update config
    match state.config.lock() {
        Ok(mut cfg) => {
            cfg.device_config = device_config.clone();
            match cfg.save() {
                Ok(_) => {
                    // A running tool owns the display; the render loop re-applies
                    // the saved config when it ends.
                    let tool_running = state.tool.lock().map(|t| t.is_active()).unwrap_or(false);
                    if tool_running {
                        return Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, "application/json")
                            .body(
                                json!({
                                    "success": true,
                                    "message": "Device configuration saved; it will apply when the running tool ends"
                                })
                                .to_string()
                                .into(),
                            )
                            .unwrap();
                    }
                    // Apply device configuration if connected
                    if let Ok(mut wrapper) = state.pixoo.lock() {
                        if let Some(pixoo) = wrapper.get_mut() {
                            match apply_device_config(pixoo, &device_config) {
                                Ok(_) => {
                                    let success = json!({
                                        "success": true,
                                        "message": "Device configuration updated and applied"
                                    });
                                    Response::builder()
                                        .status(StatusCode::OK)
                                        .header(header::CONTENT_TYPE, "application/json")
                                        .body(success.to_string().into())
                                        .unwrap()
                                }
                                Err(e) => {
                                    let error = json!({
                                        "error": format!("Failed to apply device configuration: {}", e)
                                    });
                                    Response::builder()
                                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                                        .header(header::CONTENT_TYPE, "application/json")
                                        .body(error.to_string().into())
                                        .unwrap()
                                }
                            }
                        } else {
                            let success = json!({
                                "success": true,
                                "message": "Device configuration saved (no device connected)"
                            });
                            Response::builder()
                                .status(StatusCode::OK)
                                .header(header::CONTENT_TYPE, "application/json")
                                .body(success.to_string().into())
                                .unwrap()
                        }
                    } else {
                        let error = json!({"error": "Failed to access Pixoo connection"});
                        Response::builder()
                            .status(StatusCode::INTERNAL_SERVER_ERROR)
                            .header(header::CONTENT_TYPE, "application/json")
                            .body(error.to_string().into())
                            .unwrap()
                    }
                }
                Err(e) => {
                    let error = json!({"error": format!("Failed to save config: {}", e)});
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(error.to_string().into())
                        .unwrap()
                }
            }
        }
        Err(_) => {
            let error = json!({"error": "Failed to update config"});
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(error.to_string().into())
                .unwrap()
        }
    }
}
