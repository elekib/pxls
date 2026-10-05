use crate::config::Config;
use crate::renderer::Renderer;
use crate::token_manager::TokenManager;
use anyhow::Result;
use image::DynamicImage;
use serde::Deserialize;
use serde_json;
use std::sync::Arc;
use tracing::{debug, info, warn};

pub struct GpuStatsPage;

/// Get color based on usage percentage
/// - 0-50%: Green (good)
/// - 50-75%: Yellow (okay)
/// - 75-90%: Orange (concerning)
/// - 90-100%: Red (critical)
fn get_usage_color(usage: u32) -> [u8; 3] {
    match usage {
        0..=50 => [0, 255, 0],    // Green - Good
        51..=75 => [255, 255, 0], // Yellow - Okay
        76..=90 => [255, 165, 0], // Orange - Concerning
        _ => [255, 0, 0],         // Red - Critical
    }
}

// Dashdot GPU API response struct
#[derive(Deserialize, Debug)]
#[allow(dead_code)]
struct DashdotGpu {
    #[serde(default)]
    load: f32,
    #[serde(default)]
    temp: f32,
    #[serde(default)]
    memory: f32,
}

// Beszel API structs for GPU data
#[derive(Deserialize, Debug, Default)]
#[allow(dead_code)]
struct BeszelGpuInfo {
    #[serde(default)]
    load: Option<f64>,
    #[serde(default)]
    memory: Option<f64>,
    #[serde(default)]
    temp: Option<f64>,
}

#[derive(Deserialize, Debug, Default)]
struct BeszelSystemInfo {
    #[serde(default)]
    gpu: Option<Vec<BeszelGpuInfo>>,
    #[serde(default)]
    gpu_temp: Option<f64>,
    // Additional fields that might contain GPU data
    #[serde(default)]
    gpu_power: Option<f64>,
    #[serde(default)]
    gpu_usage: Option<f64>,
    #[serde(default)]
    gpu_memory_used: Option<f64>,
    #[serde(default)]
    gpu_memory_total: Option<f64>,
    // 'g' appears to be GPU usage in Beszel's compact format
    #[serde(default)]
    g: Option<f64>,
    // Potential GPU memory fields in compact format
    #[serde(default)]
    gm: Option<f64>,
    #[serde(default)]
    gmem: Option<f64>,
    #[serde(default)]
    gpumem: Option<f64>,
    #[serde(flatten)]
    extra: std::collections::HashMap<String, serde_json::Value>,
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

#[derive(Deserialize, Debug, Default)]
#[allow(dead_code)]
struct BeszelListResponse<T> {
    #[serde(default)]
    items: Vec<T>,
}

impl GpuStatsPage {
    pub fn render(
        source: &str,
        dashdot_url: Option<&str>,
        beszel_hub_url: Option<&str>,
        beszel_system_id: Option<&str>,
        brand_text: &str,
        brand_color: &str,
        token_manager: Option<&Arc<TokenManager>>,
    ) -> Result<DynamicImage> {
        debug!(source = %source, brand = %brand_text, "Rendering GPU stats page");
        let mut img = DynamicImage::new_rgba8(16, 16);
        Renderer::clear_screen(&mut img);

        let (gpu_load, gpu_memory) = match source {
            "beszel" => {
                if let Some(hub_url) = beszel_hub_url {
                    Self::fetch_beszel_gpu_stats(hub_url, beszel_system_id, token_manager)
                } else {
                    warn!("Beszel source selected but no hub URL provided");
                    (None, None)
                }
            }
            _ => {
                // Default to dashdot
                if let Some(url) = dashdot_url {
                    Self::fetch_dashdot_gpu_stats(url)
                } else {
                    warn!("Dashdot source selected but no URL provided");
                    (None, None)
                }
            }
        };

        Self::render_gpu_stats(&mut img, gpu_load, gpu_memory, brand_text, brand_color)
    }

    fn render_gpu_stats(
        img: &mut DynamicImage,
        gpu_load: Option<u32>,
        _gpu_memory: Option<u32>,
        brand_text: &str,
        brand_color: &str,
    ) -> Result<DynamicImage> {
        let config = Config::default();
        let brand_rgb = config.hex_to_rgb(brand_color);

        // Display GPU stats - VRAM commented out due to inconsistent data
        match gpu_load {
            Some(load) => {
                let load_rgb = get_usage_color(load);
                info!(load, "GPU load fetched");
                Renderer::draw_text(img, &format!("L{load}%"), 0, 0, load_rgb, 1);
            }
            None => {
                warn!("Failed to fetch GPU load, showing offline state");
                let offline_color = [100, 100, 100];
                Renderer::draw_text(img, "L--", 0, 0, offline_color, 1);
            }
        }

        // Brand text at bottom (same as SystemStats)
        Renderer::draw_text(img, brand_text, 0, 11, brand_rgb, 0);

        Ok(img.clone())
    }

    fn fetch_dashdot_gpu_stats(dashdot_url: &str) -> (Option<u32>, Option<u32>) {
        // Dashdot GPU API endpoint: /load/gpu
        let gpu_url = format!("{}/load/gpu", dashdot_url.trim_end_matches('/'));
        debug!(url = %gpu_url, "Fetching GPU from dashdot");
        let gpu_result = ureq::get(&gpu_url)
            .timeout(std::time::Duration::from_secs(3))
            .call();

        match gpu_result {
            Ok(response) => {
                match serde_json::from_str::<Vec<DashdotGpu>>(
                    &response.into_string().unwrap_or_default(),
                ) {
                    Ok(gpus) => {
                        if gpus.is_empty() {
                            warn!("GPU response contained empty array");
                            (None, None)
                        } else {
                            let gpu = &gpus[0];
                            let load_val = gpu.load.round() as u32;
                            let memory_val = gpu.memory.round() as u32;
                            debug!(load = load_val, memory = memory_val, "GPU stats fetched");
                            (Some(load_val), Some(memory_val))
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "Failed to parse GPU response");
                        (None, None)
                    }
                }
            }
            Err(e) => {
                warn!(error = %e, url = %gpu_url, "Failed to fetch GPU from dashdot");
                (None, None)
            }
        }
    }

    fn fetch_beszel_gpu_stats(
        hub_url: &str,
        system_id: Option<&str>,
        token_manager: Option<&Arc<TokenManager>>,
    ) -> (Option<u32>, Option<u32>) {
        // Get token from token manager if available
        let auth_token = token_manager.and_then(|tm| tm.get_token());

        // Try to fetch stats - if auth fails, try to refresh token and retry
        let result = Self::try_fetch_beszel_gpu_stats(
            hub_url,
            system_id,
            auth_token.as_deref(),
            token_manager,
        );

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
                    let retry_result = Self::try_fetch_beszel_gpu_stats(
                        hub_url,
                        system_id,
                        Some(&new_token),
                        token_manager,
                    );
                    if let Err(ref e) = retry_result {
                        warn!(error = %e, "GPU stats fetch failed even after token refresh");
                    }
                    return retry_result.unwrap_or((None, None));
                }
            } else {
                warn!("Token refresh failed, cannot retry GPU stats fetch");
            }
        }

        // Log any non-auth errors
        if let Err(ref e) = result {
            if !is_auth_error {
                warn!(error = %e, "GPU stats fetch failed");
            }
        }

        result.unwrap_or((None, None))
    }

    fn try_fetch_beszel_gpu_stats(
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
                match super::beszel::resolve_system_id(hub_url, Some(id), token_manager) {
                    Some(sid) => sid,
                    None => {
                        warn!(name = %id, "System not found by name");
                        return Err(anyhow::anyhow!("System not found: {id}"));
                    }
                }
            } else {
                id.to_string()
            }
        } else {
            match super::beszel::resolve_system_id(hub_url, None, token_manager) {
                Some(sid) => sid,
                None => {
                    warn!("No Beszel systems found");
                    return Err(anyhow::anyhow!("No system found"));
                }
            }
        };

        debug!(system_id = %system_id, "Fetching GPU stats for system");

        // Fetch system record with GPU stats
        let path = format!("/api/collections/systems/records/{system_id}");
        let url = format!("{hub_url}{path}");
        let mut req = ureq::get(&url).timeout(std::time::Duration::from_secs(5));

        if let Some(token) = auth_token {
            req = req.set("Authorization", &format!("Bearer {token}"));
        }

        let resp = match req.call() {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, url = %url, "Failed to fetch system record from Beszel");
                super::beszel::note_failure(hub_url, requested, &e);
                return Err(anyhow::Error::from(e));
            }
        };

        let body = resp.into_string().unwrap_or_default();
        debug!(response_body = %body[..body.len().min(500)], system_id = %system_id, "Beszel system API response");

        match serde_json::from_str::<BeszelSystemRecord>(&body) {
            Ok(record) => {
                let info = match record.info {
                    Some(i) => i,
                    None => {
                        warn!(system_id = %system_id, "No info field in Beszel system record");
                        return Ok((None, None));
                    }
                };

                // Log all potential GPU data sources
                debug!(
                    gpu_array = ?info.gpu,
                    gpu_temp = ?info.gpu_temp,
                    gpu_power = ?info.gpu_power,
                    gpu_usage = ?info.gpu_usage,
                    gpu_memory_used = ?info.gpu_memory_used,
                    gpu_memory_total = ?info.gpu_memory_total,
                    g_field = ?info.g,
                    gm_field = ?info.gm,
                    gmem_field = ?info.gmem,
                    gpumem_field = ?info.gpumem,
                    extra_fields = ?info.extra,
                    "Beszel GPU data sources"
                );

                // Try to get GPU data from system info first
                let gpus = match info.gpu {
                    Some(g) => g,
                    None => {
                        // Check alternative GPU data sources in system info
                        if info.gpu_usage.is_some() || info.gpu_memory_used.is_some() {
                            let load = info.gpu_usage.map(|v| v.round() as u32);
                            let memory = info.gpu_memory_used.map(|v| v.round() as u32);
                            info!(load = ?load, memory = ?memory, "Using alternative GPU fields");
                            return Ok((load, memory));
                        }

                        // Check for 'g' field which appears to be GPU usage in Beszel's compact format
                        if let Some(gpu_load) = info.g {
                            let load_pct = gpu_load.round() as u32;
                            // Check for GPU memory in compact format fields first
                            let mem_pct = info
                                .gm
                                .or(info.gmem)
                                .or(info.gpumem)
                                .map(|v| v.round() as u32);

                            info!(load = load_pct, memory = ?mem_pct, "Using compact GPU fields (g/gm/gmem/gpumem)");
                            return Ok((Some(load_pct), mem_pct));
                        }

                        // Beszel reports no GPU data for this system (e.g. the agent's
                        // GPU collector is failing), so show the offline state.
                        warn!(system_id = %system_id, "Beszel reports no GPU data for this system, check the Beszel agent logs");
                        return Ok((None, None));
                    }
                };

                let gpu = match gpus.first() {
                    Some(g) => g,
                    None => {
                        warn!(system_id = %system_id, "Empty GPU array in Beszel response");
                        return Ok((None, None));
                    }
                };

                let load = gpu.load.map(|v| v.round() as u32);
                let memory = gpu.memory.map(|v| v.round() as u32);

                if load.is_none() && memory.is_none() {
                    warn!(system_id = %system_id, "GPU load and memory are both null");
                } else {
                    info!(load = ?load, memory = ?memory, system_id = %system_id, "Beszel GPU stats fetched successfully");
                }

                Ok((load, memory))
            }
            Err(e) => {
                warn!(error = %e, body = %body, "Failed to parse Beszel system record");
                Err(anyhow::anyhow!("Parse error: {e}"))
            }
        }
    }
}
