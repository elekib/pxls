use crate::notification::ActiveNotification;
use crate::renderer::Renderer;
use image::{DynamicImage, GenericImage, Rgba};
use std::time::{SystemTime, UNIX_EPOCH};

const WIDTH: u32 = 16;
const HEIGHT: u32 = 16;

pub fn render_notification_page(notification: &ActiveNotification) -> DynamicImage {
    // Check if this is an image notification
    if notification.display_mode == "image" {
        if let Some(ref image_data) = notification.image {
            // Return the image directly (already 16x16)
            return DynamicImage::ImageRgba8(image_data.clone());
        }
    }

    let mut img = DynamicImage::new_rgba8(WIDTH, HEIGHT);

    // Parse colors from hex strings
    let bg_color = hex_to_rgb(&notification.background_color);
    let text_color = hex_to_rgb(&notification.text_color);

    // Determine if we should flash (invert colors)
    let flash_on = if notification.flash {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        // Flash every flash_speed_ms milliseconds
        (timestamp / notification.flash_speed_ms as u128).is_multiple_of(2)
    } else {
        false
    };

    // If flashing, invert colors
    let (display_bg, display_text) = if flash_on {
        (text_color, bg_color) // Inverted
    } else {
        (bg_color, text_color) // Normal
    };

    // Fill background
    for py in 0..HEIGHT {
        for px in 0..WIDTH {
            img.put_pixel(
                px,
                py,
                Rgba([display_bg[0], display_bg[1], display_bg[2], 255]),
            );
        }
    }

    // Get text
    let title = get_word(&notification.title, 4);
    let subtitle = get_word(&notification.subtitle, 4);

    match notification.display_mode.as_str() {
        "icon_only" => {
            // Draw icon image if available, otherwise fall back to 2-letter code
            if let Some(ref icon_img) = notification.icon_image {
                // Center the 8x8 icon in the 16x16 display
                let icon_x = 4i64;
                let icon_y = 4i64;
                image::imageops::overlay(&mut img, icon_img, icon_x, icon_y);
            } else {
                // Fallback to 2-letter code
                let icon = get_icon_code(&notification.icon);
                let icon_x = 4i32;
                let icon_y = 6i32;
                Renderer::draw_text(&mut img, &icon, icon_x, icon_y, display_text, 1);
            }
        }
        "icon_with_text" => {
            let has_icon_image = notification.icon_image.is_some();
            let icon_code = get_icon_code(&notification.icon);
            let has_icon = has_icon_image || !icon_code.is_empty();

            if has_icon {
                // Draw icon image if available at top, otherwise fall back to 2-letter code
                if let Some(ref icon_img) = notification.icon_image {
                    // Center the 8x8 icon at the top
                    let icon_x = 4i64;
                    let icon_y = 1i64;
                    image::imageops::overlay(&mut img, icon_img, icon_x, icon_y);
                } else {
                    // Fallback to 2-letter code
                    let icon_x = if icon_code.len() == 2 { 4i32 } else { 6i32 };
                    Renderer::draw_text(&mut img, &icon_code, icon_x, 1, display_text, 1);
                }

                // Title below icon
                if !title.is_empty() {
                    let title_width = title.len() as i32 * 4 - 1;
                    let title_x = (16 - title_width) / 2;
                    Renderer::draw_text(&mut img, &title, title_x, 7, display_text, 1);
                }

                // Subtitle at bottom
                if !subtitle.is_empty() {
                    let sub_width = subtitle.len() as i32 * 4 - 1;
                    let sub_x = (16 - sub_width) / 2;
                    Renderer::draw_text(&mut img, &subtitle, sub_x, 12, display_text, 1);
                }
            } else {
                // No icon configured — center text vertically like text mode
                if !title.is_empty() && !subtitle.is_empty() {
                    let title_width = title.len() as i32 * 4 - 1;
                    let title_x = (16 - title_width) / 2;
                    Renderer::draw_text(&mut img, &title, title_x, 2, display_text, 1);

                    let sub_width = subtitle.len() as i32 * 4 - 1;
                    let sub_x = (16 - sub_width) / 2;
                    Renderer::draw_text(&mut img, &subtitle, sub_x, 8, display_text, 1);
                } else if !title.is_empty() {
                    let title_width = title.len() as i32 * 4 - 1;
                    let title_x = (16 - title_width) / 2;
                    Renderer::draw_text(&mut img, &title, title_x, 4, display_text, 1);
                } else if !subtitle.is_empty() {
                    let sub_width = subtitle.len() as i32 * 4 - 1;
                    let sub_x = (16 - sub_width) / 2;
                    Renderer::draw_text(&mut img, &subtitle, sub_x, 4, display_text, 1);
                }
            }
        }
        _ => {
            // Default "text" mode - text only, no icon
            // Title at row 2, subtitle at row 8: a 5px-tall line each, so the
            // block is vertically centred (it used to sit 2 rows too low)
            if !title.is_empty() {
                let title_width = title.len() as i32 * 4 - 1;
                let title_x = (16 - title_width) / 2;
                Renderer::draw_text(&mut img, &title, title_x, 2, display_text, 1);
            }

            if !subtitle.is_empty() {
                let sub_width = subtitle.len() as i32 * 4 - 1;
                let sub_x = (16 - sub_width) / 2;
                Renderer::draw_text(&mut img, &subtitle, sub_x, 8, display_text, 1);
            }
        }
    }

    img
}

fn hex_to_rgb(hex: &str) -> [u8; 3] {
    let hex = hex.trim_start_matches('#');
    if hex.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&hex[0..2], 16),
            u8::from_str_radix(&hex[2..4], 16),
            u8::from_str_radix(&hex[4..6], 16),
        ) {
            return [r, g, b];
        }
    }
    // Default to cyan if invalid
    [0, 255, 255]
}

fn get_icon_code(icon: &str) -> String {
    if icon.contains("📺") {
        "TV".to_string()
    } else if icon.contains("🎬") {
        "MV".to_string()
    } else if icon.contains("📥") {
        "DL".to_string()
    } else if icon.contains("🧪") {
        "TS".to_string()
    } else if icon.contains("🔔") {
        "NT".to_string()
    } else if icon.contains("⚡") {
        "NR".to_string()
    } else if icon.contains("✅") {
        "OK".to_string()
    } else if icon.contains("❌") {
        "XX".to_string()
    } else {
        icon.chars().take(2).collect::<String>().to_uppercase()
    }
}

fn get_word(text: &str, max_len: usize) -> String {
    text.split_whitespace()
        .next()
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(max_len)
        .collect::<String>()
        .to_ascii_uppercase()
}
