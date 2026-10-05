use axum::{
    extract::State,
    Json,
    response::Response,
    http::{StatusCode, header},
};
use bluetooth_serial_port::BtAddr;
use serde::Deserialize;
use serde_json::json;
use std::str::FromStr;
use std::sync::atomic::Ordering;
use tracing::{info, error, instrument};

use crate::AppState;
use crate::config::DeviceConfig;
use crate::rendering::device_config::apply_device_config;
use pixoo::Pixoo;

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
            match Pixoo::connect(bt_addr) {
                Ok(mut new_pixoo) => {
                    // Apply device configuration after connection
                    let device_config = {
                        let cfg = state.config.lock().unwrap();
                        cfg.device_config.clone()
                    };
                    
                    if let Err(e) = apply_device_config(&mut new_pixoo, &device_config) {
                        error!(error = %e, "Failed to apply device configuration during connection");
                    }
                    
                    match state.pixoo.lock() {
                        Ok(mut wrapper) => {
                            wrapper.replace(new_pixoo);
                            wrapper.set_bt_addr(bt_addr);
                            
                            match state.config.lock() {
                                Ok(mut cfg) => {
                                    cfg.pixoo_mac = req.mac.clone();
                                    let _ = cfg.save();
                                }
                                Err(_) => {}
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

    // Get tool active status
    let (tool_active_until, tool_type) = {
        let tool_until = state.tool_active_until.lock().unwrap();
        let active_tool = state.active_tool_type.lock().unwrap();
        let until = if std::time::Instant::now() < *tool_until {
            let duration = tool_until.duration_since(std::time::Instant::now());
            let sys_time = std::time::SystemTime::now() + duration;
            Some(sys_time)
        } else {
            None
        };
        (until, active_tool.clone())
    };

    let status = json!({
        "connected": is_connected,
        "manual_disconnect": manual_disconnect,
        "tool_active_until": tool_active_until.map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339()),
        "tool_type": tool_type
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
