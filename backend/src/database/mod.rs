use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use anyhow::{Context, Result};
use tracing::info;

use crate::webhook_enhanced::{EnhancedWebhookConfig, WebhookEvent};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhooksDatabase {
    pub webhooks: Vec<EnhancedWebhookConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventsDatabase {
    pub events: Vec<WebhookEvent>,
}

pub struct WebhookDatabase {
    data_dir: String,
}

impl WebhookDatabase {
    pub fn new(data_dir: &str) -> Self {
        Self {
            data_dir: data_dir.to_string(),
        }
    }

    fn ensure_data_dir(&self) -> Result<()> {
        if !Path::new(&self.data_dir).exists() {
            fs::create_dir_all(&self.data_dir)
                .context("Failed to create data directory")?;
        }
        Ok(())
    }

    fn write_atomic<T: Serialize>(&self, path: &str, data: &T) -> Result<()> {
        let temp_path = format!("{}.tmp", path);
        let content = serde_json::to_string_pretty(data)
            .context("Failed to serialize data")?;
        
        fs::write(&temp_path, content)
            .context("Failed to write temp file")?;
        
        fs::rename(&temp_path, path)
            .context("Failed to rename temp file to final path")?;
        
        Ok(())
    }

    pub fn load_webhooks(&self) -> Result<WebhooksDatabase> {
        self.ensure_data_dir()?;
        let path = format!("{}/webhooks.json", self.data_dir);
        
        if Path::new(&path).exists() {
            let content = fs::read_to_string(&path)
                .context("Failed to read webhooks.json")?;
            let db: WebhooksDatabase = serde_json::from_str(&content)
                .context("Failed to parse webhooks.json")?;
            Ok(db)
        } else {
            let db = WebhooksDatabase { webhooks: Vec::new() };
            self.write_atomic(&path, &db)?;
            Ok(db)
        }
    }

    pub fn save_webhooks(&self, db: &WebhooksDatabase) -> Result<()> {
        self.ensure_data_dir()?;
        let path = format!("{}/webhooks.json", self.data_dir);
        self.write_atomic(&path, db)?;
        info!("Saved webhooks database");
        Ok(())
    }

    pub fn load_events(&self) -> Result<EventsDatabase> {
        self.ensure_data_dir()?;
        let path = format!("{}/webhook_events.json", self.data_dir);
        
        if Path::new(&path).exists() {
            let content = fs::read_to_string(&path)
                .context("Failed to read webhook_events.json")?;
            let db: EventsDatabase = serde_json::from_str(&content)
                .context("Failed to parse webhook_events.json")?;
            Ok(db)
        } else {
            let db = EventsDatabase { events: Vec::new() };
            self.write_atomic(&path, &db)?;
            Ok(db)
        }
    }

    pub fn save_events(&self, db: &EventsDatabase) -> Result<()> {
        self.ensure_data_dir()?;
        let path = format!("{}/webhook_events.json", self.data_dir);
        self.write_atomic(&path, db)?;
        Ok(())
    }

    /// Append an event, trimming the log to `max_per_webhook` entries for that
    /// webhook and 1000 events overall.
    pub fn log_event(&self, event: WebhookEvent, max_per_webhook: usize) -> Result<()> {
        let mut db = self.load_events()?;
        let webhook_name = event.webhook_name.clone();
        db.events.push(event);

        // Trim oldest events for this webhook beyond its cap
        let matching: Vec<usize> = db.events
            .iter()
            .enumerate()
            .filter(|(_, e)| e.webhook_name == webhook_name)
            .map(|(i, _)| i)
            .collect();

        if matching.len() > max_per_webhook {
            let to_remove: std::collections::HashSet<usize> = matching
                [..matching.len() - max_per_webhook]
                .iter()
                .copied()
                .collect();
            let mut i = 0;
            db.events.retain(|_| {
                let keep = !to_remove.contains(&i);
                i += 1;
                keep
            });
        }

        // Global cap
        while db.events.len() > 1000 {
            db.events.remove(0);
        }

        self.save_events(&db)?;
        Ok(())
    }

    pub fn get_events(&self, webhook_name: Option<String>, limit: Option<usize>) -> Result<Vec<WebhookEvent>> {
        let db = self.load_events()?;
        let filtered: Vec<WebhookEvent> = if let Some(name) = webhook_name {
            db.events.iter().filter(|e| e.webhook_name == name).cloned().collect()
        } else {
            db.events.clone()
        };

        if let Some(limit) = limit {
            Ok(filtered.into_iter().rev().take(limit).collect())
        } else {
            Ok(filtered.into_iter().rev().collect())
        }
    }

    pub fn clear_events(&self, webhook_name: Option<String>) -> Result<()> {
        let mut db = self.load_events()?;
        if let Some(ref name) = webhook_name {
            db.events.retain(|e| e.webhook_name != *name);
        } else {
            db.events.clear();
        }
        self.save_events(&db)?;
        info!("Cleared events for webhook: {:?}", webhook_name);
        Ok(())
    }

    pub fn migrate_from_config(&self, old_webhooks: Vec<crate::config::WebhookConfig>) -> Result<()> {
        let mut db = self.load_webhooks()?;
        
        for old_webhook in old_webhooks {
            // Check if webhook already exists
            if db.webhooks.iter().any(|w| w.name == old_webhook.name || w.path == old_webhook.path) {
                info!("Webhook {} already exists, skipping migration", old_webhook.name);
                continue;
            }

            // Convert to enhanced config
            let enhanced = EnhancedWebhookConfig {
                name: old_webhook.name.clone(),
                enabled: old_webhook.enabled,
                path: old_webhook.path.clone(),
                log_events: true,
                max_events: 100,
                rules: Vec::new(),
                default_actions: Vec::new(),
                display_on_no_match: true,
                // Preserve old display settings
                duration_secs: old_webhook.duration_secs as u32,
                display_mode: old_webhook.display_mode,
                background_color: old_webhook.background_color,
                text_color: old_webhook.text_color,
                title_field: old_webhook.title_field,
                subtitle_field: old_webhook.subtitle_field,
                flash: old_webhook.flash,
                flash_speed_ms: old_webhook.flash_speed_ms as u32,
                icon: old_webhook.icon,
                icon_image_url: old_webhook.icon_image_url,
                image_url_field: old_webhook.image_url_field,
            };

            db.webhooks.push(enhanced);
            info!("Migrated webhook: {}", old_webhook.name);
        }

        self.save_webhooks(&db)?;
        info!("Migration completed");
        Ok(())
    }
}
