use crate::config::Config;
use crate::renderer::Renderer;
use crate::token_manager::TokenManager;
use anyhow::Result;
use image::DynamicImage;
use serde::Deserialize;
use serde_json;
use std::sync::Arc;
use tracing::{debug, info, warn};

pub struct SystemStatsPage;

/// Get color based on usage percentage
fn get_usage_color(usage: u32) -> [u8; 3] {
    match usage {
        0..=50 => [0, 255, 0],      // Green - Good
        51..=75 => [255, 255, 0],   // Yellow - Okay
        76..=90 => [255, 165, 0],   // Orange - Concerning
        _ => [255, 0, 0],           // Red - Critical
    }
}

// Dashdot API structs
#[derive(Deserialize, Debug)]
struct DashdotCpuCore { load: f32 }

#[derive(Deserialize, Debug)]
struct DashdotRamLoad { #[serde(default)] load: Option<f64> }

#[derive(Deserialize, Debug)]
struct DashdotInfo { #[serde(default)] ram: Option<DashdotRamInfo> }

#[derive(Deserialize, Debug)]
struct DashdotRamInfo { #[serde(default, rename = "size")] size: Option<u64> }

// Beszel API structs
#[derive(Deserialize, Debug, Default)]
struct BeszelSystemInfo {
    #[serde(default)] cpu: Option<f64>,
    #[serde(default, rename = "mp")] mem_percent: Option<f64>,
}

#[derive(Deserialize, Debug, Default)]
struct BeszelSystemRecord {
    id: String,
    #[serde(default)] name: Option<String>,
    #[serde(default)] info: Option<BeszelSystemInfo>,
}

#[derive(Deserialize, Debug, Default)]
struct BeszelListResponse<T> { #[serde(default)] items: Vec<T> }

impl SystemStatsPage {
    pub fn render(
        source: &str,
        dashdot_url: Option<&str>,
        beszel_hub_url: Option<&str>,
        beszel_system_id: Option<&str>,
        brand_text: &str,
        brand_color: &str,
        token_manager: Option<&Arc<TokenManager>>,
    ) -> Result<DynamicImage> {
        debug!(source = %source, brand = %brand_text, "Rendering system stats page");
        let mut img = DynamicImage::new_rgba8(16, 16);
        Renderer::clear_screen(&mut img);

        let (cpu_percent, ram_percent) = match source {
            "beszel" => {
                if let Some(hub_url) = beszel_hub_url {
                    Self::fetch_beszel_stats(hub_url, beszel_system_id, token_manager)
                } else {
                    warn!("Beszel source selected but no hub URL provided");
                    (None, None)
                }
            }
            _ => {
                // Default to dashdot
                if let Some(url) = dashdot_url {
                    Self::fetch_dashdot_stats(url)
                } else {
                    warn!("Dashdot source selected but no URL provided");
                    (None, None)
                }
            }
        };

        Self::render_stats(&mut img, cpu_percent, ram_percent, brand_text, brand_color)
    }

    fn render_stats(
        img: &mut DynamicImage,
        cpu_percent: Option<u32>,
        ram_percent: Option<u32>,
        brand_text: &str,
        brand_color: &str,
    ) -> Result<DynamicImage> {
        let config = Config::default();
        let brand_rgb = config.hex_to_rgb(brand_color);

        if let (Some(cpu), Some(ram)) = (cpu_percent, ram_percent) {
            let cpu_rgb = get_usage_color(cpu);
            let ram_rgb = get_usage_color(ram);
            info!(cpu, ram, "System stats fetched successfully");
            Renderer::draw_text(img, &format!("C{}%", cpu), 0, 0, cpu_rgb, 1);
            Renderer::draw_text(img, &format!("R{}%", ram), 0, 6, ram_rgb, 1);
        } else {
            warn!("Failed to fetch system stats, showing offline state");
            let offline_color = [100, 100, 100];
            Renderer::draw_text(img, "C--", 0, 0, offline_color, 1);
            Renderer::draw_text(img, "R--", 0, 6, offline_color, 1);
        }
        Renderer::draw_text(img, brand_text, 0, 11, brand_rgb, 0);
        Ok(img.clone())
    }

    fn fetch_dashdot_stats(dashdot_url: &str) -> (Option<u32>, Option<u32>) {
        let cpu_url = format!("{}/load/cpu", dashdot_url.trim_end_matches('/'));
        debug!(url = %cpu_url, "Fetching CPU from dashdot");
        let cpu_result = ureq::get(&cpu_url)
            .timeout(std::time::Duration::from_secs(3))
            .call();
        
        let cpu_percent = match cpu_result {
            Ok(response) => {
                match serde_json::from_str::<Vec<DashdotCpuCore>>(&response.into_string().unwrap_or_default()) {
                    Ok(cores) if !cores.is_empty() => {
                        let avg_load: f32 = cores.iter().map(|c| c.load).sum::<f32>() / cores.len() as f32;
                        Some(avg_load.round() as u32)
                    }
                    _ => None,
                }
            }
            Err(_) => None,
        };

        let info_url = format!("{}/info", dashdot_url.trim_end_matches('/'));
        let info_result = ureq::get(&info_url)
            .timeout(std::time::Duration::from_secs(3))
            .call();
        
        let total_ram = match info_result {
            Ok(response) => response.into_json::<DashdotInfo>().ok().and_then(|i| i.ram).and_then(|r| r.size),
            Err(_) => None,
        };
        
        let ram_url = format!("{}/load/ram", dashdot_url.trim_end_matches('/'));
        let ram_result = ureq::get(&ram_url)
            .timeout(std::time::Duration::from_secs(3))
            .call();
        
        let ram_percent = match ram_result {
            Ok(response) => {
                match response.into_json::<DashdotRamLoad>() {
                    Ok(ram_data) => {
                        if let (Some(used), Some(total)) = (ram_data.load, total_ram) {
                            if total > 0 { Some(((used / total as f64) * 100.0) as u32) } else { Some(0) }
                        } else { None }
                    }
                    Err(_) => None,
                }
            }
            Err(_) => None,
        };
        
        (cpu_percent, ram_percent)
    }

    fn fetch_beszel_stats(
        hub_url: &str,
        system_id: Option<&str>,
        token_manager: Option<&Arc<TokenManager>>,
    ) -> (Option<u32>, Option<u32>) {
        // Get token from token manager if available
        let auth_token = token_manager.and_then(|tm| tm.get_token());

        // Try to fetch stats - if auth fails, try to refresh token and retry
        let result = Self::try_fetch_beszel_stats(hub_url, system_id, auth_token.as_deref(), token_manager);

        // Check if we got an auth error (401/403)
        let is_auth_error = result.as_ref().err()
            .and_then(|e| e.downcast_ref::<ureq::Error>())
            .map_or(false, |ue| matches!(ue, ureq::Error::Status(401 | 403, _)));

        if is_auth_error {
            debug!("Auth error (401/403), attempting token refresh");
            if let Some(tm) = token_manager {
                if let Some(new_token) = tm.refresh_token() {
                    // Retry with new token
                    return Self::try_fetch_beszel_stats(hub_url, system_id, Some(&new_token), token_manager)
                        .unwrap_or((None, None));
                }
            }
        }

        result.unwrap_or((None, None))
    }

    fn try_fetch_beszel_stats(
        hub_url: &str,
        system_id: Option<&str>,
        auth_token: Option<&str>,
        token_manager: Option<&Arc<TokenManager>>,
    ) -> Result<(Option<u32>, Option<u32>)> {
        let requested = system_id;
        // Get system ID if not provided, or resolve name to ID
        let system_id = if let Some(id) = system_id {
            // Check if this looks like a name (not a PocketBase ID)
            if id.len() < 15 || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
                debug!(name = %id, "Looking up system by name");
                super::beszel::resolve_system_id(hub_url, Some(id), token_manager)
                    .ok_or_else(|| anyhow::anyhow!("System '{}' not found", id))?
            } else {
                id.to_string()
            }
        } else {
            super::beszel::resolve_system_id(hub_url, None, token_manager)
                .ok_or_else(|| anyhow::anyhow!("No systems found"))?
        };

        // Fetch system record with stats
        let path = format!("/api/collections/systems/records/{}", system_id);
        let mut req = ureq::get(&format!("{}{}", hub_url, path))
            .timeout(std::time::Duration::from_secs(5));

        if let Some(token) = auth_token {
            req = req.set("Authorization", &format!("Bearer {}", token));
        }

        let resp = req.call().map_err(|e| {
            super::beszel::note_failure(hub_url, requested, &e);
            e
        })?;
        let body = resp.into_string().unwrap_or_default();

        match serde_json::from_str::<BeszelSystemRecord>(&body) {
            Ok(record) => {
                if let Some(info) = record.info {
                    let cpu = info.cpu.map(|v| v.round() as u32);
                    let ram = info.mem_percent.map(|v| v.round() as u32);
                    debug!(cpu, ram, "Beszel stats fetched");
                    Ok((cpu, ram))
                } else {
                    Ok((None, None))
                }
            }
            Err(_) => Ok((None, None)),
        }
    }
}
