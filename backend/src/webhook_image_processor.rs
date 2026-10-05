use std::collections::HashMap;
use image::{ImageFormat, DynamicImage, RgbaImage, Rgba, GenericImageView};
use tracing::{info, warn, error};
use anyhow::{Result, anyhow};
use base64::Engine;
use serde_json::Value;

use crate::webhook_enhanced::{WebhookAction, ActionType};

pub struct WebhookImageProcessor {
    image_cache: HashMap<String, RgbaImage>,
}

impl WebhookImageProcessor {
    pub fn new() -> Self {
        Self {
            image_cache: HashMap::new(),
        }
    }

    pub async fn process_image_action(&mut self, action: &WebhookAction, payload: &Value) -> Result<RgbaImage> {
        match &action.action_type {
            ActionType::DisplayImage => {
                self.render_image_from_webhook_data(action, payload).await
            }
            _ => Err(anyhow!("Not an image action"))
        }
    }

    async fn render_image_from_webhook_data(&mut self, action: &WebhookAction, payload: &Value) -> Result<RgbaImage> {
        // Extract image source from parameters
        let image_source = action.parameters.get("image_source")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("Missing image_source parameter"))?;

        match image_source {
            "url" => {
                let url = action.parameters.get("url")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow!("Missing url parameter"))?;
                self.download_and_process_image(url, action).await
            }
            "base64" => {
                let base64_data = action.parameters.get("base64_data")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow!("Missing base64_data parameter"))?;
                self.process_base64_image(base64_data, action).await
            }
            "template" => {
                self.render_template_image(action, payload).await
            }
            "text_overlay" => {
                self.render_text_overlay_image(action, payload).await
            }
            _ => Err(anyhow!("Unsupported image source: {}", image_source))
        }
    }

    async fn download_and_process_image(&mut self, url: &str, action: &WebhookAction) -> Result<RgbaImage> {
        info!("Downloading image from URL: {}", url);
        
        let response = reqwest::get(url).await
            .map_err(|e| anyhow!("Failed to download image: {}", e))?;

        let image_bytes = response.bytes().await
            .map_err(|e| anyhow!("Failed to read image bytes: {}", e))?;

        let img = image::load_from_memory(&image_bytes)
            .map_err(|e| anyhow!("Failed to parse image: {}", e))?;

        self.process_image_with_params(img, action).await
    }

    async fn process_base64_image(&mut self, base64_data: &str, action: &WebhookAction) -> Result<RgbaImage> {
        info!("Processing base64 image");
        
        // Remove data URL prefix if present
        let clean_base64 = base64_data.split(',').last().unwrap_or(base64_data);
        
        let image_bytes = base64::engine::general_purpose::STANDARD.decode(clean_base64)
            .map_err(|e| anyhow!("Failed to decode base64: {}", e))?;

        let img = image::load_from_memory(&image_bytes)
            .map_err(|e| anyhow!("Failed to parse base64 image: {}", e))?;

        self.process_image_with_params(img, action).await
    }

    async fn render_template_image(&mut self, action: &WebhookAction, payload: &Value) -> Result<RgbaImage> {
        let template_type = action.parameters.get("template_type")
            .and_then(|v| v.as_str())
            .unwrap_or("notification");

        match template_type {
            "notification" => self.render_notification_template(action, payload).await,
            "status" => self.render_status_template(action, payload).await,
            "chart" => self.render_chart_template(action, payload).await,
            _ => Err(anyhow!("Unknown template type: {}", template_type))
        }
    }

    async fn render_notification_template(&mut self, action: &WebhookAction, payload: &Value) -> Result<RgbaImage> {
        // Create a 16x16 notification template
        let mut img = RgbaImage::new(16, 16);
        
        // Background color
        let bg_color = action.parameters.get("background_color")
            .and_then(|v| v.as_str())
            .unwrap_or("1a1a1a");
        
        let bg_rgb = self.parse_hex_color(bg_color)?;
        for pixel in img.pixels_mut() {
            *pixel = Rgba([bg_rgb.0, bg_rgb.1, bg_rgb.2, 255]);
        }

        // Extract title and text from payload
        let title = payload.get("title")
            .or_else(|| payload.get("subject"))
            .and_then(|v| v.as_str())
            .unwrap_or("Alert");

        let text = payload.get("text")
            .or_else(|| payload.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Add simple text rendering (this is a basic implementation)
        self.add_text_to_image(&mut img, title, 2, 2, 0xFFFFFF)?;
        self.add_text_to_image(&mut img, text, 2, 6, 0xCCCCCC)?;

        Ok(img)
    }

    async fn render_status_template(&mut self, action: &WebhookAction, payload: &Value) -> Result<RgbaImage> {
        let status = payload.get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        let mut img = RgbaImage::new(16, 16);
        
        // Color based on status
        let color = match status {
            "success" | "ok" => (0, 255, 0),
            "error" | "fail" => (255, 0, 0),
            "warning" | "warn" => (255, 255, 0),
            _ => (128, 128, 128),
        };

        for pixel in img.pixels_mut() {
            *pixel = Rgba([color.0, color.1, color.2, 255]);
        }

        // Add status text
        self.add_text_to_image(&mut img, status, 4, 6, 0x000000)?;

        Ok(img)
    }

    async fn render_chart_template(&mut self, action: &WebhookAction, payload: &Value) -> Result<RgbaImage> {
        let mut img = RgbaImage::new(16, 16);
        
        // Black background
        for pixel in img.pixels_mut() {
            *pixel = Rgba([0, 0, 0, 255]);
        }

        // Extract chart data
        if let Some(chart_data) = payload.get("chart_data").and_then(|v| v.as_array()) {
            let max_y = 12;
            let max_x = 14;
            
            for (i, value) in chart_data.iter().enumerate() {
                if let Some(num) = value.as_f64() {
                    let x = (i * 2) % max_x;
                    let y = max_y - (num as u32 % max_y);
                    
                    if x < 16 && y < 16 {
                        img.put_pixel(x as u32, y as u32, Rgba([0, 255, 0, 255]));
                    }
                }
            }
        }

        Ok(img)
    }

    async fn render_text_overlay_image(&mut self, action: &WebhookAction, payload: &Value) -> Result<RgbaImage> {
        let base_image_url = action.parameters.get("base_image_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("Missing base_image_url parameter"))?;

        // Download base image
        let response = reqwest::get(base_image_url).await
            .map_err(|e| anyhow!("Failed to download base image: {}", e))?;

        let image_bytes = response.bytes().await
            .map_err(|e| anyhow!("Failed to read base image bytes: {}", e))?;

        let mut img = image::load_from_memory(&image_bytes)
            .map_err(|e| anyhow!("Failed to parse base image: {}", e))?
            .to_rgba8();

        // Add text overlay
        let overlay_text = action.parameters.get("overlay_text")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let text_color = action.parameters.get("text_color")
            .and_then(|v| v.as_str())
            .and_then(|s| u32::from_str_radix(s, 16).ok())
            .unwrap_or(0xFFFFFF);

        self.add_text_to_image(&mut img, overlay_text, 5, 5, text_color)?;

        Ok(img)
    }

    async fn process_image_with_params(&self, mut img: DynamicImage, action: &WebhookAction) -> Result<RgbaImage> {
        // Default to the Pixoo's 16x16 screen size. Allow override via action params.
        let target_w = action
            .parameters
            .get("width")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(16);
        let target_h = action
            .parameters
            .get("height")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(16);

        // "Cover" resize: scale to fill the target dimensions while maintaining
        // aspect ratio, then center-crop the overflow. This ensures the full
        // image is visible on the 16x16 screen rather than a tiny corner crop.
        let (orig_w, orig_h) = img.dimensions();
        if orig_w > 0 && orig_h > 0 && (orig_w != target_w || orig_h != target_h) {
            let scale_w = target_w as f32 / orig_w as f32;
            let scale_h = target_h as f32 / orig_h as f32;
            let scale = scale_w.max(scale_h);
            let scaled_w = (orig_w as f32 * scale).round().max(1.0) as u32;
            let scaled_h = (orig_h as f32 * scale).round().max(1.0) as u32;
            img = img.resize_exact(scaled_w, scaled_h, image::imageops::FilterType::Lanczos3);
            // Center-crop to exact target dimensions.
            let excess_w = scaled_w.saturating_sub(target_w);
            let excess_h = scaled_h.saturating_sub(target_h);
            // Optional `crop_y_offset` slides the visible window down the image
            // (content moves up); tall posters keep their titles toward the bottom.
            let crop_y_offset = action
                .parameters
                .get("crop_y_offset")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let crop_x = excess_w / 2;
            let crop_y = ((excess_h / 2) as i64 + crop_y_offset).clamp(0, excess_h as i64) as u32;
            img = img.crop_imm(crop_x, crop_y, target_w, target_h);
        }

        // Convert to RGBA
        Ok(img.to_rgba8())
    }

    fn add_text_to_image(&self, img: &mut RgbaImage, text: &str, x: u32, y: u32, color: u32) -> Result<()> {
        // This is a very basic text rendering implementation
        // In a production system, you'd want to use a proper font rendering library
        
        let r = ((color >> 16) & 0xFF) as u8;
        let g = ((color >> 8) & 0xFF) as u8;
        let b = (color & 0xFF) as u8;
        
        // Simple pixel-based text rendering (just for demonstration)
        for (i, ch) in text.chars().enumerate() {
            let char_x = x + (i as u32 * 2);
            if char_x < 16 && y < 16 {
                // Draw a simple representation of the character
                img.put_pixel(char_x, y, Rgba([r, g, b, 255]));
                if char_x + 1 < 16 {
                    img.put_pixel(char_x + 1, y, Rgba([r, g, b, 255]));
                }
                if y + 1 < 16 {
                    img.put_pixel(char_x, y + 1, Rgba([r, g, b, 255]));
                }
            }
        }
        
        Ok(())
    }

    fn parse_hex_color(&self, hex: &str) -> Result<(u8, u8, u8)> {
        let hex = hex.trim_start_matches('#');
        if hex.len() != 6 {
            return Err(anyhow!("Invalid hex color format"));
        }

        let r = u8::from_str_radix(&hex[0..2], 16)?;
        let g = u8::from_str_radix(&hex[2..4], 16)?;
        let b = u8::from_str_radix(&hex[4..6], 16)?;

        Ok((r, g, b))
    }
}
