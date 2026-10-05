//! Persistence in a single SQLite file, `<data dir>/pxls.db`.
//!
//! Holds the app config, webhook definitions and the webhook event log (this
//! replaces config.json, webhooks.json and webhook_events.json). Uploaded
//! images stay on disk. The file contains secrets: keep it private and back it
//! up (use `sqlite3 pxls.db ".backup ..."`, or copy the -wal file with it).
//!
//! The API is synchronous. Each call opens its own connection and runs off the
//! async executor (see [`db::off_executor`]).

use anyhow::Result;
use rusqlite::{Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::info;

use crate::config::Config;
use crate::webhook_enhanced::{EnhancedWebhookConfig, WebhookEvent};

pub mod accounts;
mod db;
mod import;
mod migrations;
mod store;
#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhooksDatabase {
    pub webhooks: Vec<EnhancedWebhookConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventsDatabase {
    pub events: Vec<WebhookEvent>,
}

/// Run `f` in a write transaction on a fresh connection, off the executor.
fn write<T>(data_dir: &str, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    db::off_executor(|| {
        let mut conn = db::open(Path::new(data_dir))?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    })
}

fn read<T>(data_dir: &str, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    db::off_executor(|| f(&db::open(Path::new(data_dir))?))
}

/// Load the saved config, or `None` if none has been saved yet.
pub fn load_config(data_dir: &str) -> Result<Option<Config>> {
    read(data_dir, store::load_config)
}

pub fn save_config(data_dir: &str, config: &Config) -> Result<()> {
    write(data_dir, |c| store::save_config(c, config))
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

    pub fn load_webhooks(&self) -> Result<WebhooksDatabase> {
        read(&self.data_dir, |c| {
            Ok(WebhooksDatabase {
                webhooks: store::load_webhooks(c)?,
            })
        })
    }

    pub fn save_webhooks(&self, db: &WebhooksDatabase) -> Result<()> {
        write(&self.data_dir, |c| store::replace_webhooks(c, &db.webhooks))?;
        info!("Saved webhooks database");
        Ok(())
    }

    pub fn load_events(&self) -> Result<EventsDatabase> {
        read(&self.data_dir, |c| {
            Ok(EventsDatabase {
                events: store::load_events(c, None)?,
            })
        })
    }

    pub fn save_events(&self, db: &EventsDatabase) -> Result<()> {
        write(&self.data_dir, |c| store::replace_events(c, &db.events))
    }

    /// Append an event, trimming the log to `max_per_webhook` entries for that
    /// webhook and 1000 events overall.
    pub fn log_event(&self, event: WebhookEvent, max_per_webhook: usize) -> Result<()> {
        write(&self.data_dir, |c| {
            store::insert_event(c, &event)?;
            store::trim_events(c, &event.webhook_name, max_per_webhook)
        })
    }

    /// Events newest first, optionally for one webhook and limited.
    pub fn get_events(
        &self,
        webhook_name: Option<String>,
        limit: Option<usize>,
    ) -> Result<Vec<WebhookEvent>> {
        read(&self.data_dir, |c| {
            store::recent_events(c, webhook_name.as_deref(), limit)
        })
    }

    pub fn clear_events(&self, webhook_name: Option<String>) -> Result<()> {
        write(&self.data_dir, |c| {
            store::clear_events(c, webhook_name.as_deref())
        })?;
        info!("Cleared events for webhook: {:?}", webhook_name);
        Ok(())
    }

    /// Give every webhook that has no secret a random one, so existing webhooks
    /// keep working once they are configured in the sender. Returns how many were set.
    pub fn ensure_secrets(&self) -> Result<usize> {
        write(&self.data_dir, |c| {
            let mut webhooks = store::load_webhooks(c)?;
            let mut changed = 0;
            for webhook in webhooks.iter_mut() {
                if webhook.secret.0.is_empty() {
                    webhook.secret = crate::auth::Secret(crate::auth::generate_secret());
                    changed += 1;
                }
            }
            if changed > 0 {
                store::replace_webhooks(c, &webhooks)?;
            }
            Ok(changed)
        })
    }

    pub fn migrate_from_config(
        &self,
        old_webhooks: Vec<crate::config::WebhookConfig>,
    ) -> Result<()> {
        write(&self.data_dir, |c| {
            let mut webhooks = store::load_webhooks(c)?;

            for old_webhook in old_webhooks {
                // Check if webhook already exists
                if webhooks
                    .iter()
                    .any(|w| w.name == old_webhook.name || w.path == old_webhook.path)
                {
                    info!(
                        "Webhook {} already exists, skipping migration",
                        old_webhook.name
                    );
                    continue;
                }

                // Convert to enhanced config
                let enhanced = EnhancedWebhookConfig {
                    name: old_webhook.name.clone(),
                    enabled: old_webhook.enabled,
                    path: old_webhook.path.clone(),
                    secret: crate::auth::Secret(crate::auth::generate_secret()),
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

                webhooks.push(enhanced);
                info!("Migrated webhook: {}", old_webhook.name);
            }

            store::replace_webhooks(c, &webhooks)?;
            info!("Migration completed");
            Ok(())
        })
    }
}
