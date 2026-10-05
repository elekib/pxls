use crate::config::Config;
use crate::renderer::Renderer;
use crate::token_manager::TokenManager;
use anyhow::Result;
use image::DynamicImage;
use serde::Deserialize;
use serde_json;
use std::sync::Arc;
use tracing::{debug, info, warn};

pub struct TempsPage;

/// Get color based on temperature
/// - 0-50°C: Green (good)
/// - 50-70°C: Yellow (warm)
/// - 70-85°C: Orange (hot)
/// - 85°C+: Red (critical)
fn get_temp_color(temp: u32) -> [u8; 3] {
    match temp {
        0..=50 => [0, 255, 0],    // Green - Good
        51..=70 => [255, 255, 0], // Yellow - Warm
        71..=85 => [255, 165, 0], // Orange - Hot
        _ => [255, 0, 0],         // Red - Critical
    }
}

// Dashdot CPU API response struct
#[derive(Deserialize, Debug)]
struct DashdotCpuCore {
    #[serde(default)]
    temp: f32,
}

// Beszel API structs for temperature data
#[derive(Deserialize, Debug, Default)]
#[allow(dead_code)]
struct BeszelSystemInfo {
    #[serde(default, rename = "cpuTemp")]
    cpu_temp: Option<f64>,
    #[serde(default, rename = "gpuTemp")]
    gpu_temp: Option<f64>,
    #[serde(default, rename = "dt")]
    device_temp: Option<f64>, // Device temperature from beszel agent
    #[serde(default)]
    temps: Option<serde_json::Value>, // For additional temp sensors
}

#[derive(Deserialize, Debug, Default)]
#[allow(dead_code)]
struct BeszelSystemRecord {
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    info: Option<BeszelSystemInfo>,
}

// Stats response for time-series data (includes cpuTemp)
#[derive(Deserialize, Debug, Default)]
#[allow(dead_code)]
struct BeszelStatsResponse {
    #[serde(default)]
    stats: Vec<BeszelStatEntry>,
}

#[derive(Deserialize, Debug, Default)]
#[allow(dead_code)]
struct BeszelStatEntry {
    #[serde(default, rename = "cpuTemp")]
    cpu_temp: Option<f64>,
    #[serde(default, rename = "gpuTemp")]
    gpu_temp: Option<f64>,
}

#[derive(Deserialize, Debug, Default)]
#[allow(dead_code)]
struct BeszelListResponse<T> {
    #[serde(default)]
    items: Vec<T>,
}

// Temperature data structure for all sensor types
#[derive(Debug, Default)]
struct TempData {
    cpu: Option<u32>,
    gpu: Option<u32>,
    storage: Option<u32>,
}

impl TempsPage {
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        source: &str,
        dashdot_url: Option<&str>,
        beszel_hub_url: Option<&str>,
        beszel_system_id: Option<&str>,
        brand_text: &str,
        brand_color: &str,
        show_cpu: bool,
        show_gpu: bool,
        show_storage: bool,
        token_manager: Option<&Arc<TokenManager>>,
    ) -> Result<DynamicImage> {
        debug!(source = %source, brand = %brand_text, show_cpu, show_gpu, show_storage, "Rendering temps page");
        let mut img = DynamicImage::new_rgba8(16, 16);
        Renderer::clear_screen(&mut img);

        let temps = match source {
            "beszel" => {
                if let Some(hub_url) = beszel_hub_url {
                    Self::fetch_beszel_temps(hub_url, beszel_system_id, token_manager)
                } else {
                    warn!("Beszel source selected but no hub URL provided");
                    TempData::default()
                }
            }
            _ => {
                // Default to dashdot (only supports CPU)
                let cpu = dashdot_url.and_then(Self::fetch_dashdot_temps);
                TempData {
                    cpu,
                    gpu: None,
                    storage: None,
                }
            }
        };

        Self::render_temps(
            &mut img,
            temps,
            brand_text,
            brand_color,
            show_cpu,
            show_gpu,
            show_storage,
        )
    }

    fn render_temps(
        img: &mut DynamicImage,
        temps: TempData,
        brand_text: &str,
        brand_color: &str,
        show_cpu: bool,
        show_gpu: bool,
        show_storage: bool,
    ) -> Result<DynamicImage> {
        let config = Config::default();
        let brand_rgb = config.hex_to_rgb(brand_color);

        // Build list of temperatures to display (max 2 lines on 16x16 display)
        let mut display_temps: Vec<(char, Option<u32>)> = Vec::new();
        if show_cpu {
            display_temps.push(('C', temps.cpu));
        }
        if show_gpu {
            display_temps.push(('G', temps.gpu));
        }
        if show_storage {
            display_temps.push(('S', temps.storage));
        }

        // Limit to 2 temperatures (display constraint)
        let display_temps: Vec<_> = display_temps.into_iter().take(2).collect();

        // Y positions for 1 or 2 lines - render from very top (y=0)
        let y_positions: Vec<i32> = match display_temps.len() {
            1 => vec![0],    // Single line, at very top
            2 => vec![0, 6], // Two lines, top and middle
            _ => vec![0],    // Default fallback
        };

        for (i, (label, temp)) in display_temps.iter().enumerate() {
            let y_pos = y_positions.get(i).copied().unwrap_or(0);

            if let Some(t) = temp {
                let rgb = get_temp_color(*t);
                let temp_str = format!("{}{}", label, t);
                let temp_width = temp_str.len() as i32 * 4 - 1;
                Renderer::draw_text(img, &temp_str, 0, y_pos, rgb, 1);
                // Draw degree symbol after temperature
                Renderer::draw_text(img, "*", temp_width + 1, y_pos, rgb, 0);
            } else {
                // Show placeholder for missing temp
                let placeholder = format!("{}--*", label);
                Renderer::draw_text(img, &placeholder, 0, y_pos, [100, 100, 100], 1);
            }
        }

        // If no temps selected, show message at top
        if display_temps.is_empty() {
            Renderer::draw_text(img, "NO TMP", 0, 0, [100, 100, 100], 1);
        }

        // Brand text at bottom (y=11 so 5-pixel font fits within 16-pixel height)
        Renderer::draw_text(img, brand_text, 0, 11, brand_rgb, 0);

        info!(cpu = ?temps.cpu, gpu = ?temps.gpu, storage = ?temps.storage, "Temps displayed");
        Ok(img.clone())
    }

    fn fetch_dashdot_temps(dashdot_url: &str) -> Option<u32> {
        // Fetch CPU temps from dashdot
        let cpu_url = format!("{}/load/cpu", dashdot_url.trim_end_matches('/'));
        debug!(url = %cpu_url, "Fetching CPU temps from dashdot");
        let cpu_result = ureq::get(&cpu_url)
            .timeout(std::time::Duration::from_secs(3))
            .call();

        match cpu_result {
            Ok(response) => {
                match serde_json::from_str::<Vec<DashdotCpuCore>>(
                    &response.into_string().unwrap_or_default(),
                ) {
                    Ok(cores) if !cores.is_empty() => {
                        // Get max temp across all cores
                        let max_temp = cores.iter().map(|c| c.temp).fold(0.0, f32::max);
                        let temp_val = max_temp.round() as u32;
                        debug!(cpu_temp = temp_val, "CPU max temp fetched");
                        Some(temp_val)
                    }
                    _ => None,
                }
            }
            Err(e) => {
                warn!(error = %e, "Failed to fetch CPU temps");
                None
            }
        }
    }

    fn fetch_beszel_temps(
        hub_url: &str,
        system_id: Option<&str>,
        token_manager: Option<&Arc<TokenManager>>,
    ) -> TempData {
        // Get token from token manager if available
        let auth_token = token_manager.and_then(|tm| tm.get_token());

        // Try to fetch stats - if auth fails, try to refresh token and retry
        let result =
            Self::try_fetch_beszel_temps(hub_url, system_id, auth_token.as_deref(), token_manager);

        // Check if we got an auth error (401/403)
        let is_auth_error = result
            .as_ref()
            .err()
            .and_then(|e| e.downcast_ref::<ureq::Error>())
            .is_some_and(|ue| matches!(ue, ureq::Error::Status(401 | 403, _)));

        if is_auth_error {
            debug!("Auth error (401/403), attempting token refresh");
            if let Some(tm) = token_manager {
                if let Some(new_token) = tm.refresh_token() {
                    // Retry with new token
                    return Self::try_fetch_beszel_temps(
                        hub_url,
                        system_id,
                        Some(&new_token),
                        token_manager,
                    )
                    .unwrap_or_default();
                }
            }
        }

        result.unwrap_or_default()
    }

    fn try_fetch_beszel_temps(
        hub_url: &str,
        system_id: Option<&str>,
        auth_token: Option<&str>,
        token_manager: Option<&Arc<TokenManager>>,
    ) -> Result<TempData> {
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

        // Fetch system record from beszel
        let path = format!("/api/collections/systems/records/{}", system_id);
        let url = format!("{}{}", hub_url, path);
        debug!(url = %url, "Fetching beszel system record for temps");

        let mut req = ureq::get(&url).timeout(std::time::Duration::from_secs(5));

        if let Some(token) = auth_token {
            req = req.set("Authorization", &format!("Bearer {}", token));
        }

        let resp = req.call().inspect_err(|e| {
            super::beszel::note_failure(hub_url, requested, e);
        })?;
        let status = resp.status();
        let body = resp.into_string().unwrap_or_default();

        if status != 200 {
            warn!(status, body = %body[..body.len().min(200)], "Beszel system record request returned non-200 status");
            return Ok(TempData::default());
        }

        // Log raw body for debugging
        debug!(body = %body, "Beszel API raw response");

        match serde_json::from_str::<BeszelSystemRecord>(&body) {
            Ok(record) => {
                let info = record.info.as_ref();

                // Debug log all available fields
                if let Some(i) = info {
                    debug!(device_temp = ?i.device_temp, gpu_temp = ?i.gpu_temp, temps_obj = ?i.temps, "Beszel info fields");
                }

                // Extract all temperature values
                let cpu = info.and_then(|i| i.device_temp).map(|v| v.round() as u32);
                let gpu = info.and_then(|i| i.gpu_temp).map(|v| v.round() as u32);

                // For storage temp, try to extract from temps object - look for nvme_composite fields
                let storage = info
                    .and_then(|i| i.temps.as_ref())
                    .and_then(|t| {
                        debug!(temps_keys = ?t.as_object().map(|o| o.keys().collect::<Vec<_>>()), "Temps object keys");
                        // Try various storage temp field names
                        t.get("nvme_composite")
                            .or_else(|| t.get("nvme_composite_2"))
                            .or_else(|| t.get("storage"))
                            .or_else(|| t.get("disk"))
                    })
                    .and_then(|v| v.as_f64())
                    .map(|v| v.round() as u32);

                // Also fetch smart devices for drive temps
                let smart_storage_temp =
                    Self::fetch_smart_device_temps(hub_url, &system_id, auth_token);
                info!(smart_temp = ?smart_storage_temp, "Smart device temp fetched");

                // Use smart device temp if available, otherwise fall back to temps object
                let storage = storage.or(smart_storage_temp);

                let temps = TempData { cpu, gpu, storage };
                info!(cpu = ?cpu, gpu = ?gpu, storage = ?storage, "Beszel temperatures fetched from system record");
                Ok(temps)
            }
            Err(e) => {
                warn!(error = %e, body = %body[..body.len().min(200)], "Failed to parse Beszel system record");
                Ok(TempData::default())
            }
        }
    }

    fn fetch_smart_device_temps(
        hub_url: &str,
        system_id: &str,
        auth_token: Option<&str>,
    ) -> Option<u32> {
        let path = format!(
            "/api/collections/smart_devices/records?filter=system='{}'&perPage=100",
            system_id
        );
        let url = format!("{}{}", hub_url, path);
        debug!(url = %url, "Fetching smart devices for drive temps");

        let mut req = ureq::get(&url).timeout(std::time::Duration::from_secs(5));

        if let Some(token) = auth_token {
            req = req.set("Authorization", &format!("Bearer {}", token));
        }

        let resp = req.call().ok()?;
        let body = resp.into_string().unwrap_or_default();

        #[derive(Deserialize, Debug)]
        struct SmartDevice {
            temp: Option<f64>,
            attributes: Option<Vec<SmartAttribute>>,
        }

        #[derive(Deserialize, Debug)]
        struct SmartAttribute {
            n: String,
            rv: i64,
        }

        #[derive(Deserialize, Debug)]
        struct SmartDeviceList {
            items: Vec<SmartDevice>,
        }

        let data: SmartDeviceList = serde_json::from_str(&body).ok()?;

        // Find first valid temperature from smart devices
        for device in data.items {
            // Check direct temp field
            if let Some(t) = device.temp {
                if t > 0.0 {
                    info!(temp = t, "Found drive temp from temp field");
                    return Some(t.round() as u32);
                }
            }
            // Check SMART attributes for Temperature
            if let Some(attrs) = device.attributes {
                for attr in attrs {
                    if attr.n == "Temperature" && attr.rv > 0 {
                        info!(temp = attr.rv, "Found drive temp from SMART attributes");
                        return Some(attr.rv as u32);
                    }
                }
            }
        }

        None
    }
}
