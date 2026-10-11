pub mod beszel;
pub mod clock_weather;
pub mod custom_pixels;
pub mod custom_script;
pub mod custom_text;
pub mod gpu_stats;
pub mod image_upload;
pub mod system_stats;
pub mod temps;

use crate::config::{CustomPage, PageType};
use crate::pages::{
    clock_weather::ClockWeatherPage, custom_pixels::CustomPixelsPage,
    custom_script::CustomScriptPage, custom_text::CustomTextPage, gpu_stats::GpuStatsPage,
    image_upload::ImageUploadPage, system_stats::SystemStatsPage, temps::TempsPage,
};
use crate::pixoo_wrapper::PixooWrapper;
use crate::token_manager::TokenManager;
use anyhow::Result;
use image::DynamicImage;
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tracing::{debug, error, instrument};

pub struct PageRenderer;

impl PageRenderer {
    #[instrument(skip(_sys, token_manager, page), fields(page_name = %page.name))]
    pub fn render_page(
        page: &CustomPage,
        _sys: &System,
        token_manager: Option<&Arc<TokenManager>>,
    ) -> Result<DynamicImage> {
        debug!("Rendering page");
        match &page.page_type {
            PageType::ClockWeather {
                clock_color,
                date_color,
                weather_color,
                weather_location,
                temperature_unit,
            } => ClockWeatherPage::render(
                clock_color,
                date_color,
                weather_color,
                weather_location,
                temperature_unit,
            ),
            PageType::SystemStats {
                source,
                dashdot_url,
                beszel_hub_url,
                beszel_system_id,
                brand_text,
                brand_color,
            } => SystemStatsPage::render(
                source,
                dashdot_url.as_deref(),
                beszel_hub_url.as_deref(),
                beszel_system_id.as_deref(),
                brand_text,
                brand_color,
                token_manager,
            ),
            PageType::GpuStats {
                source,
                dashdot_url,
                beszel_hub_url,
                beszel_system_id,
                brand_text,
                brand_color,
            } => GpuStatsPage::render(
                source,
                dashdot_url.as_deref(),
                beszel_hub_url.as_deref(),
                beszel_system_id.as_deref(),
                brand_text,
                brand_color,
                token_manager,
            ),
            PageType::Temps {
                source,
                dashdot_url,
                beszel_hub_url,
                beszel_system_id,
                brand_text,
                brand_color,
                show_cpu,
                show_gpu,
                show_storage,
            } => TempsPage::render(
                source,
                dashdot_url.as_deref(),
                beszel_hub_url.as_deref(),
                beszel_system_id.as_deref(),
                brand_text,
                brand_color,
                *show_cpu,
                *show_gpu,
                *show_storage,
                token_manager,
            ),
            PageType::CustomScript {
                script_path,
                interval: _,
                inputs,
            } => CustomScriptPage::render(script_path, inputs),
            PageType::ImageUpload {
                mode,
                frame_duration,
                file_path,
            } => ImageUploadPage::render(mode, file_path.as_deref(), *frame_duration),
            PageType::CustomPixels { pixels } => CustomPixelsPage::render(pixels),
            PageType::CustomText {
                text,
                y,
                color,
                background_color,
                scroll_speed,
                enable_scroll,
            } => CustomTextPage::render(
                text,
                *y,
                color,
                background_color,
                *enable_scroll,
                (*scroll_speed).try_into().unwrap_or(500),
            ),
            // Divoom native modes - these are handled by apply_divoom_mode, not rendered
            PageType::DivoomEnvironment { .. } => Ok(DynamicImage::new_rgb8(16, 16)),
            PageType::DivoomLight { .. } => Ok(DynamicImage::new_rgb8(16, 16)),
            PageType::DivoomMusic { .. } => Ok(DynamicImage::new_rgb8(16, 16)),
            PageType::DivoomUser { .. } => Ok(DynamicImage::new_rgb8(16, 16)),
            PageType::DivoomScore { .. } => Ok(DynamicImage::new_rgb8(16, 16)),
        }
    }

    #[instrument(skip(pixoo, img))]
    pub fn push_image(pixoo: &Arc<Mutex<PixooWrapper>>, img: DynamicImage) -> Result<()> {
        if let Ok(mut wrapper) = pixoo.lock() {
            if let Some(p) = wrapper.get_mut() {
                match p.set_image(&image::DynamicImage::ImageRgb8(img.to_rgb8())) {
                    Ok(_) => {
                        debug!("Image pushed to device successfully");
                        Ok(())
                    }
                    Err(e) => {
                        // Check if it's a connection error
                        let error_str = e.to_string().to_lowercase();
                        if error_str.contains("transport endpoint")
                            || error_str.contains("not connected")
                            || error_str.contains("connection")
                            || error_str.contains("107")
                        {
                            error!(error = %e, "Connection lost during image push");
                            // Clear the connection to force reconnect
                            *wrapper = PixooWrapper::new();
                            return Err(anyhow::anyhow!("Connection lost during image push: {e}"));
                        }
                        Err(e.into())
                    }
                }
            } else {
                error!("No active Pixoo connection");
                Err(anyhow::anyhow!("No active Pixoo connection"))
            }
        } else {
            error!("Failed to acquire Pixoo lock");
            Err(anyhow::anyhow!("Failed to acquire Pixoo lock"))
        }
    }
}
