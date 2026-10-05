use crate::config::{Config, ScriptInput};
use crate::renderer::Renderer;
use anyhow::Result;
use image::DynamicImage;
use tracing::{debug, error, warn};

pub struct CustomScriptPage;

impl CustomScriptPage {
    pub fn render(script_path: &str, inputs: &[ScriptInput]) -> Result<DynamicImage> {
        debug!(script = %script_path, input_count = inputs.len(), "Rendering custom script page");
        let mut cmd = std::process::Command::new("sh");
        cmd.arg("-c").arg(script_path);

        for input in inputs {
            let env_name = format!("INPUT_{}", input.name.to_uppercase());
            cmd.env(&env_name, &input.default_value);
        }

        let output = cmd.output();

        let mut img = image::RgbaImage::new(16, 16);

        for y in 0..16 {
            for x in 0..16 {
                img.put_pixel(x, y, image::Rgba([0, 0, 0, 255]));
            }
        }

        match output {
            Ok(o) if o.status.success() => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                debug!(output_len = stdout.len(), "Custom script executed successfully");
                if let Ok(pixels) = serde_json::from_str::<Vec<crate::config::Pixel>>(&stdout) {
                    let config = Config::default();
                    for pixel in pixels {
                        let rgb = config.hex_to_rgb(&pixel.color);
                        if pixel.x < 16 && pixel.y < 16 {
                            img.put_pixel(pixel.x as u32, pixel.y as u32, image::Rgba([rgb[0], rgb[1], rgb[2], 255]));
                        }
                    }
                } else {
                    let text = stdout.lines().next().unwrap_or("script").to_string();
                    let mut display = DynamicImage::ImageRgba8(img);
                    Renderer::draw_text(&mut display, &text[..text.len().min(5)], 0, 6, [255, 255, 255], 0);
                    return Ok(display);
                }
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                error!(exit_code = ?o.status.code(), stderr = %stderr, "Custom script failed");
                let mut display = DynamicImage::ImageRgba8(img);
                Renderer::draw_text(&mut display, "ERR", 4, 6, [255, 0, 0], 0);
                return Ok(display);
            }
            Err(e) => {
                error!(error = %e, "Failed to execute custom script");
                let mut display = DynamicImage::ImageRgba8(img);
                Renderer::draw_text(&mut display, "ERR", 4, 6, [255, 0, 0], 0);
                return Ok(display);
            }
        }

        Ok(DynamicImage::ImageRgba8(img))
    }
}
