use anyhow::{Context, Result};
use image::{Rgba, RgbaImage};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::{error, info, warn};

use crate::notification::NotificationManager;
use crate::pixoo_wrapper::PixooWrapper;
use crate::webhook_enhanced::{
    extract_field_as_string, substitute_placeholders, ActionType, DisplayDefaults, WebhookAction,
};
use crate::webhook_image_processor::WebhookImageProcessor;

pub struct ActionExecutor {
    notification_manager: NotificationManager,
    image_processor: Arc<tokio::sync::Mutex<WebhookImageProcessor>>,
    pixoo: Arc<Mutex<PixooWrapper>>,
}

impl ActionExecutor {
    pub fn new(
        notification_manager: NotificationManager,
        image_processor: Arc<tokio::sync::Mutex<WebhookImageProcessor>>,
        pixoo: Arc<Mutex<PixooWrapper>>,
    ) -> Self {
        Self {
            notification_manager,
            image_processor,
            pixoo,
        }
    }

    pub async fn execute_action(
        &self,
        action: &WebhookAction,
        payload: &Value,
        defaults: &DisplayDefaults,
    ) -> Result<String> {
        match &action.action_type {
            ActionType::DisplayNotification => {
                self.execute_display_notification(action, payload, defaults)
                    .await
            }
            ActionType::DisplayImage => self.execute_display_image(action, payload, defaults).await,
            ActionType::FlashScreen => self.execute_flash_screen(action, defaults).await,
            ActionType::PlaySound => self.execute_play_sound(action).await,
            ActionType::LogEvent => self.execute_log_event(action, payload).await,
            ActionType::ForwardWebhook => self.execute_forward_webhook(action, payload).await,
        }
    }

    fn param_str<'a>(action: &'a WebhookAction, key: &str) -> Option<&'a str> {
        action.parameters.get(key).and_then(|v| v.as_str())
    }

    fn param_u64(action: &WebhookAction, key: &str) -> Option<u64> {
        action.parameters.get(key).and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
        })
    }

    fn param_bool(action: &WebhookAction, key: &str) -> Option<bool> {
        action.parameters.get(key).and_then(|v| {
            v.as_bool()
                .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
        })
    }

    /// Resolve a string parameter: substitute {field.path} placeholders, then
    /// fall back to extracting the given default field from the payload.
    fn resolve_text_param(
        &self,
        action: &WebhookAction,
        key: &str,
        default_field: &str,
        payload: &Value,
    ) -> Option<String> {
        if let Some(raw) = Self::param_str(action, key) {
            let resolved = substitute_placeholders(raw, payload);
            if !resolved.is_empty() {
                return Some(resolved);
            }
        }
        if !default_field.is_empty() {
            if let Some(v) = extract_field_as_string(payload, default_field) {
                if !v.is_empty() {
                    return Some(v);
                }
            }
        }
        None
    }

    async fn execute_display_notification(
        &self,
        action: &WebhookAction,
        payload: &Value,
        defaults: &DisplayDefaults,
    ) -> Result<String> {
        let title = self
            .resolve_text_param(action, "title", &defaults.title_field, payload)
            .unwrap_or_else(|| "Notification".to_string());

        let subtitle = self
            .resolve_text_param(action, "subtitle", &defaults.subtitle_field, payload)
            .unwrap_or_default();

        let icon = Self::param_str(action, "icon")
            .map(|s| s.to_string())
            .unwrap_or_else(|| defaults.icon.clone());

        let duration_secs =
            Self::param_u64(action, "duration_secs").unwrap_or(defaults.duration_secs);

        let display_mode = Self::param_str(action, "display_mode")
            .map(|s| s.to_string())
            .unwrap_or_else(|| defaults.display_mode.clone());

        let background_color = Self::param_str(action, "background_color")
            .map(|s| s.to_string())
            .unwrap_or_else(|| defaults.background_color.clone());

        let text_color = Self::param_str(action, "text_color")
            .map(|s| s.to_string())
            .unwrap_or_else(|| defaults.text_color.clone());

        let flash = Self::param_bool(action, "flash").unwrap_or(defaults.flash);

        let flash_speed_ms =
            Self::param_u64(action, "flash_speed_ms").unwrap_or(defaults.flash_speed_ms);

        // Icon image URL: param (with placeholders) or webhook default
        let icon_image_url = self
            .resolve_text_param(action, "icon_image_url", "", payload)
            .or_else(|| {
                if defaults.icon_image_url.is_empty() {
                    None
                } else {
                    Some(defaults.icon_image_url.clone())
                }
            });

        let icon_image = if let Some(icon_url) = icon_image_url.filter(|u| !u.is_empty()) {
            let icon_action = WebhookAction {
                action_type: ActionType::DisplayImage,
                parameters: {
                    let mut params = HashMap::new();
                    params.insert("image_source".to_string(), Value::String("url".to_string()));
                    params.insert("url".to_string(), Value::String(icon_url));
                    params.insert("width".to_string(), Value::Number(8.into()));
                    params.insert("height".to_string(), Value::Number(8.into()));
                    params
                },
            };

            let mut processor = self.image_processor.lock().await;
            match processor.process_image_action(&icon_action, payload).await {
                Ok(img) => Some(img),
                Err(e) => {
                    warn!("Failed to load icon image: {}", e);
                    None
                }
            }
        } else {
            None
        };

        self.notification_manager.trigger(
            title.clone(),
            subtitle,
            icon,
            icon_image,
            duration_secs,
            display_mode,
            background_color,
            text_color,
            flash,
            flash_speed_ms,
        );

        info!("Executed display notification: {}", title);
        Ok(format!("Displayed notification: {}", title))
    }

    async fn execute_display_image(
        &self,
        action: &WebhookAction,
        payload: &Value,
        defaults: &DisplayDefaults,
    ) -> Result<String> {
        let duration_secs =
            Self::param_u64(action, "duration_secs").unwrap_or(defaults.duration_secs);

        let flash = Self::param_bool(action, "flash").unwrap_or(defaults.flash);

        let flash_speed_ms =
            Self::param_u64(action, "flash_speed_ms").unwrap_or(defaults.flash_speed_ms);

        // Build an effective action with the image URL resolved from
        // placeholders, url_field, or the webhook's default image_url_field.
        let mut effective = action.clone();
        let source = Self::param_str(action, "image_source").unwrap_or("url");

        // Ensure image_source is set so the image processor knows which path to take.
        effective
            .parameters
            .entry("image_source".to_string())
            .or_insert_with(|| Value::String(source.to_string()));

        if source == "url" {
            let resolved_url = Self::param_str(action, "url")
                .map(|u| substitute_placeholders(u, payload))
                .filter(|u| !u.is_empty())
                .or_else(|| {
                    Self::param_str(action, "url_field")
                        .and_then(|f| extract_field_as_string(payload, f))
                })
                .or_else(|| {
                    if defaults.image_url_field.is_empty() {
                        None
                    } else {
                        extract_field_as_string(payload, &defaults.image_url_field)
                    }
                });

            match resolved_url {
                Some(url) if !url.is_empty() => {
                    effective
                        .parameters
                        .insert("url".to_string(), Value::String(url));
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "DisplayImage: no image URL (set 'url' or 'url_field' parameter)"
                    ))
                }
            }
        }

        let mut processor = self.image_processor.lock().await;
        let img = processor
            .process_image_action(&effective, payload)
            .await
            .context("Failed to process image action")?;

        self.notification_manager
            .trigger_image(img, duration_secs, flash, flash_speed_ms);

        info!("Executed display image from source: {}", source);
        Ok(format!("Displayed image from source: {}", source))
    }

    async fn execute_flash_screen(
        &self,
        action: &WebhookAction,
        defaults: &DisplayDefaults,
    ) -> Result<String> {
        let color = Self::param_str(action, "color").unwrap_or("FFFFFF");

        let duration_ms = Self::param_u64(action, "duration_ms").unwrap_or(500);

        let flash_speed_ms =
            Self::param_u64(action, "flash_speed_ms").unwrap_or(defaults.flash_speed_ms);

        let rgb = u32::from_str_radix(color.trim_start_matches('#'), 16).unwrap_or(0xFFFFFF);
        let mut img = RgbaImage::new(64, 64);
        for pixel in img.pixels_mut() {
            *pixel = Rgba([
                ((rgb >> 16) & 0xFF) as u8,
                ((rgb >> 8) & 0xFF) as u8,
                (rgb & 0xFF) as u8,
                255,
            ]);
        }

        let duration_secs = duration_ms.div_ceil(1000).max(1);
        self.notification_manager
            .trigger_image(img, duration_secs, true, flash_speed_ms.max(50));

        info!(
            "Flash screen action: color={}, duration={}ms",
            color, duration_ms
        );
        Ok(format!(
            "Flashed screen with color {} for {}ms",
            color, duration_ms
        ))
    }

    async fn execute_play_sound(&self, action: &WebhookAction) -> Result<String> {
        // sound_type presets map to (active_time_ms, off_time_ms, total_time_ms)
        let sound_type = Self::param_str(action, "sound_type").unwrap_or("default");

        let (preset_active, preset_off, preset_total) = match sound_type {
            "short" => (200, 0, 200),
            "beep" => (150, 100, 500),
            "alarm" => (400, 200, 3000),
            _ => (500, 0, 1000),
        };

        let active_time = Self::param_u64(action, "active_time_ms").unwrap_or(preset_active) as u16;
        let off_time = Self::param_u64(action, "off_time_ms").unwrap_or(preset_off) as u16;
        let total_time = Self::param_u64(action, "total_time_ms").unwrap_or(preset_total) as u16;

        let mut wrapper = self
            .pixoo
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to access Pixoo connection"))?;
        wrapper
            .play_buzzer(active_time, off_time, total_time)
            .map_err(|e| anyhow::anyhow!("Failed to play buzzer: {}", e))?;

        info!(
            "Play sound action: type={}, total={}ms",
            sound_type, total_time
        );
        Ok(format!("Played sound {} for {}ms", sound_type, total_time))
    }

    async fn execute_log_event(&self, action: &WebhookAction, payload: &Value) -> Result<String> {
        let message = Self::param_str(action, "message")
            .map(|s| substitute_placeholders(s, payload))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Event logged".to_string());

        let level = Self::param_str(action, "level").unwrap_or("info");

        match level {
            "error" => error!("{}", message),
            "warn" | "warning" => warn!("{}", message),
            _ => info!("{}", message),
        }

        Ok(format!("Logged event: {}", message))
    }

    async fn execute_forward_webhook(
        &self,
        action: &WebhookAction,
        payload: &Value,
    ) -> Result<String> {
        let url = Self::param_str(action, "url")
            .map(|u| substitute_placeholders(u, payload))
            .filter(|u| !u.is_empty())
            .ok_or_else(|| anyhow::anyhow!("Forward webhook requires url parameter"))?;

        let method = Self::param_str(action, "method")
            .unwrap_or("POST")
            .to_uppercase();

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()?;

        // Webhook URLs often embed a secret token (e.g. Home Assistant), so never
        // log or report the full URL; only the destination host.
        let target = reqwest::Url::parse(&url)
            .ok()
            .and_then(|u| {
                u.host_str().map(|h| match u.port() {
                    Some(port) => format!("{}:{}", h, port),
                    None => h.to_string(),
                })
            })
            .unwrap_or_else(|| "unknown host".to_string());

        let response = match method.as_str() {
            "GET" => client.get(&url).send().await,
            "POST" => client.post(&url).json(payload).send().await,
            "PUT" => client.put(&url).json(payload).send().await,
            "DELETE" => client.delete(&url).send().await,
            _ => return Err(anyhow::anyhow!("Unsupported HTTP method: {}", method)),
        }
        .map_err(|e| anyhow::anyhow!("Forward to {} failed: {}", target, e.without_url()))?;

        let status = response.status();
        info!("Forwarded webhook to {} with status {}", target, status);
        if !status.is_success() {
            return Err(anyhow::anyhow!("Forward to {} returned {}", target, status));
        }
        Ok(format!(
            "Forwarded webhook to {} (status: {})",
            target, status
        ))
    }
}
