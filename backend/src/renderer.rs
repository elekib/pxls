use crate::font::Font;
use image::{DynamicImage, GenericImage, GenericImageView, Rgba};

pub struct Renderer;

impl Renderer {
    pub fn draw_text(
        img: &mut DynamicImage,
        text: &str,
        x: i32,
        y: i32,
        color: [u8; 3],
        spacing: i32,
    ) {
        let mut cursor_x = x;
        let (img_width, img_height) = img.dimensions();

        for ch in text.chars() {
            let glyph = Font::get_glyph(ch);

            let char_width = match ch {
                ':' | '-' | '.' | ' ' | '*' => 1,
                _ => 3,
            };

            for (row_idx, row_bits) in glyph.iter().enumerate() {
                for col_idx in 0..char_width {
                    // Bit-check left-to-right
                    if (row_bits >> (2 - col_idx)) & 1 == 1 {
                        let px = cursor_x + col_idx;
                        let py = y + row_idx as i32;

                        if px >= 0 && px < img_width as i32 && py >= 0 && py < img_height as i32 {
                            img.put_pixel(
                                px as u32,
                                py as u32,
                                Rgba([color[0], color[1], color[2], 255]),
                            );
                        }
                    }
                }
            }
            let space = match ch {
                ':' | '-' | '.' | ',' | ' ' | '*' => 0,
                _ => spacing,
            };
            cursor_x += char_width + space;
        }
    }

    pub fn clear_screen(img: &mut DynamicImage) {
        let (width, height) = img.dimensions();
        for y in 0..height {
            for x in 0..width {
                img.put_pixel(x, y, Rgba([0, 0, 0, 255]));
            }
        }
    }
}
