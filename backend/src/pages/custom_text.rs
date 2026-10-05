use crate::config::Config;
use crate::renderer::Renderer;
use anyhow::Result;
use image::{DynamicImage, GenericImage};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::debug;

pub struct CustomTextPage;

impl CustomTextPage {
    pub fn render(
        text: &str, 
        y: u8,
        color: &str,
        background_color: &str,
        enable_scroll: bool,
        scroll_speed: u32
    ) -> Result<DynamicImage> {
        debug!(text_len = text.len(), y, enable_scroll, "Rendering custom text page");
        let mut img = DynamicImage::new_rgba8(16, 16);
        
        let config = Config::default();
        let text_rgb = config.hex_to_rgb(color);
        let bg_rgb = config.hex_to_rgb(background_color);
        
        // Fill background
        for py in 0..16 {
            for px in 0..16 {
                img.put_pixel(px, py, image::Rgba([bg_rgb[0], bg_rgb[1], bg_rgb[2], 255]));
            }
        }
        
        // Handle multi-line text by taking first line for display
        let display_line = if text.contains('\n') {
            text.lines().next().unwrap_or(text)
        } else {
            text
        };
        
        let display_text: String = if enable_scroll && display_line.len() > 5 {
            // Calculate scroll offset based on time (now using milliseconds)
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis();
            
            // Create scrolling text with spaces for smooth edge-to-edge transition
            let padded_text = format!("{}     {}", display_line, display_line);
            let total_length = padded_text.len();
            let display_width = 5;
            
            // Calculate scroll position that cycles through the padded text
            let scroll_cycle_time = scroll_speed as u128 * total_length as u128;
            let scroll_position = (timestamp % scroll_cycle_time) / scroll_speed as u128;
            let start_idx = scroll_position as usize % total_length;
            
            // Extract 5 characters for display, wrapping around if needed
            let mut result = String::with_capacity(display_width);
            for i in 0..display_width {
                let idx = (start_idx + i) % total_length;
                result.push(padded_text.chars().nth(idx).unwrap_or(' '));
            }
            
            result
        } else {
            // Display static text (no scrolling)
            if display_line.len() > 5 {
                display_line[..5].to_string()
            } else {
                display_line.to_string()
            }
        };
        
        // Draw text starting from left edge for scrolling, center for static
        if enable_scroll && display_line.len() > 5 {
            // For scrolling text, start from left edge (x=0)
            Renderer::draw_text(&mut img, &display_text, 0, y as i32, text_rgb, 0);
        } else {
            // For static text, center it horizontally
            let text_width = display_text.chars().count() as u8;
            let start_x = (16 - text_width) / 2;
            Renderer::draw_text(&mut img, &display_text, start_x as i32, y as i32, text_rgb, 0);
        }
        
        Ok(img)
    }
}
