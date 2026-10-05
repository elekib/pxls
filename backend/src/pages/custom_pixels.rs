use crate::config::{Config, Pixel};
use anyhow::Result;
use image::DynamicImage;
use tracing::debug;

pub struct CustomPixelsPage;

impl CustomPixelsPage {
    pub fn render(pixels: &[Pixel]) -> Result<DynamicImage> {
        debug!(pixel_count = pixels.len(), "Rendering custom pixels page");
        let mut img = image::RgbaImage::new(16, 16);

        for y in 0..16 {
            for x in 0..16 {
                img.put_pixel(x, y, image::Rgba([0, 0, 0, 255]));
            }
        }

        let config = Config::default();
        for pixel in pixels {
            let rgb = config.hex_to_rgb(&pixel.color);
            if pixel.x < 16 && pixel.y < 16 {
                img.put_pixel(pixel.x as u32, pixel.y as u32, image::Rgba([rgb[0], rgb[1], rgb[2], 255]));
            }
        }

        Ok(DynamicImage::ImageRgba8(img))
    }
}
