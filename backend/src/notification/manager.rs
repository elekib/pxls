use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::info;
use image::RgbaImage;

#[derive(Debug, Clone)]
pub struct ActiveNotification {
    pub title: String,
    pub subtitle: String,
    pub icon: String,
    pub icon_image: Option<RgbaImage>,
    pub expiry: Instant,
    pub display_mode: String,
    pub background_color: String,
    pub text_color: String,
    pub flash: bool,
    pub flash_speed_ms: u64,
    pub image: Option<RgbaImage>,
}

#[derive(Debug, Clone)]
pub struct NotificationManager {
    active: Arc<Mutex<Option<ActiveNotification>>>,
}

impl NotificationManager {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(None)),
        }
    }

    pub fn trigger(
        &self,
        title: String,
        subtitle: String,
        icon: String,
        icon_image: Option<RgbaImage>,
        duration_secs: u64,
        display_mode: String,
        background_color: String,
        text_color: String,
        flash: bool,
        flash_speed_ms: u64,
    ) {
        let expiry = Instant::now() + Duration::from_secs(duration_secs);
        let notification = ActiveNotification {
            title,
            subtitle,
            icon,
            icon_image,
            expiry,
            display_mode,
            background_color,
            text_color,
            flash,
            flash_speed_ms,
            image: None,
        };

        info!(
            title = %notification.title,
            subtitle = %notification.subtitle,
            duration = duration_secs,
            "Triggering notification"
        );

        if let Ok(mut guard) = self.active.lock() {
            *guard = Some(notification);
        }
    }

    pub fn trigger_image(
        &self,
        image: RgbaImage,
        duration_secs: u64,
        flash: bool,
        flash_speed_ms: u64,
    ) {
        let expiry = Instant::now() + Duration::from_secs(duration_secs);
        let notification = ActiveNotification {
            title: String::new(),
            subtitle: String::new(),
            icon: String::new(),
            icon_image: None,
            expiry,
            display_mode: "image".to_string(),
            background_color: String::new(),
            text_color: String::new(),
            flash,
            flash_speed_ms,
            image: Some(image),
        };

        info!(
            duration = duration_secs,
            "Triggering image notification"
        );

        if let Ok(mut guard) = self.active.lock() {
            *guard = Some(notification);
        }
    }

    pub fn get_active(&self) -> Option<ActiveNotification> {
        if let Ok(guard) = self.active.lock() {
            guard.clone()
        } else {
            None
        }
    }

    pub fn is_active(&self) -> bool {
        if let Ok(guard) = self.active.lock() {
            if let Some(ref notification) = *guard {
                return Instant::now() < notification.expiry;
            }
        }
        false
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.active.lock() {
            *guard = None;
        }
    }

    pub fn clear_if_expired(&self) {
        if let Ok(mut guard) = self.active.lock() {
            if let Some(ref notification) = *guard {
                if Instant::now() >= notification.expiry {
                    info!("Notification expired, clearing");
                    *guard = None;
                }
            }
        }
    }
}

impl Default for NotificationManager {
    fn default() -> Self {
        Self::new()
    }
}
