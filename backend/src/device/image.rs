//! Static 16x16 image upload (`0x44`).
//!
//! Layout, from the public Timebox Evo write-up:
//! `00 0A 0A 04 | AA LEN_LO LEN_HI 00 00 00 NN PALETTE PIXELS`
//! - `NN` is the palette size (`00` means 256), `PALETTE` is `NN` RGB triples.
//! - `PIXELS` holds one palette index per pixel, row by row from the top left,
//!   `ceil(log2(NN))` bits each (minimum 1), filled least-significant bit first.
//!
//! Assumption, needs device test: `LEN` is the length of the whole frame from
//! `AA` through the last pixel byte (the write-up only says "image data
//! length"). The write-up is for the Timebox family; a 16x16 Pixoo accepting it
//! as a single unchunked packet is unconfirmed.

use image::{imageops::FilterType, DynamicImage};

pub const CMD_IMAGE: u8 = 0x44;
const SIZE: u32 = 16;

/// Arguments for [`CMD_IMAGE`]. Images that are not 16x16 are resized.
pub fn encode(img: &DynamicImage) -> Vec<u8> {
    let rgb = img.resize_exact(SIZE, SIZE, FilterType::Nearest).to_rgb8();

    // Palette in order of first appearance. 256 pixels, so at most 256 colors.
    let mut palette: Vec<[u8; 3]> = Vec::new();
    let mut indexes: Vec<u8> = Vec::with_capacity((SIZE * SIZE) as usize);
    for px in rgb.pixels() {
        let color = px.0;
        let idx = match palette.iter().position(|c| *c == color) {
            Some(i) => i,
            None => {
                palette.push(color);
                palette.len() - 1
            }
        };
        indexes.push(idx as u8);
    }

    let bits = bits_per_pixel(palette.len());
    let mut pixels = vec![0u8; (indexes.len() * bits).div_ceil(8)];
    for (i, idx) in indexes.iter().enumerate() {
        for b in 0..bits {
            if idx >> b & 1 == 1 {
                let bit = i * bits + b;
                pixels[bit / 8] |= 1 << (bit % 8);
            }
        }
    }

    // AA + len(2) + 000000 + NN + palette + pixels
    let frame_len = 1 + 2 + 3 + 1 + palette.len() * 3 + pixels.len();
    let mut args = vec![0x00, 0x0A, 0x0A, 0x04, 0xAA];
    args.extend_from_slice(&(frame_len as u16).to_le_bytes());
    args.extend_from_slice(&[0x00, 0x00, 0x00]);
    args.push(palette.len() as u8); // 256 wraps to 0, as the format requires
    args.extend(palette.iter().flatten());
    args.extend(pixels);
    args
}

fn bits_per_pixel(colors: usize) -> usize {
    match colors {
        0..=2 => 1,
        n => (usize::BITS - (n - 1).leading_zeros()) as usize,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn solid(color: [u8; 3]) -> RgbImage {
        RgbImage::from_pixel(16, 16, Rgb(color))
    }

    #[test]
    fn bit_depth() {
        assert_eq!(bits_per_pixel(1), 1);
        assert_eq!(bits_per_pixel(2), 1);
        assert_eq!(bits_per_pixel(3), 2);
        assert_eq!(bits_per_pixel(4), 2);
        assert_eq!(bits_per_pixel(5), 3);
        assert_eq!(bits_per_pixel(256), 8);
    }

    #[test]
    fn solid_image() {
        let args = encode(&DynamicImage::ImageRgb8(solid([255, 0, 0])));
        let mut want = vec![
            0x00, 0x0A, 0x0A, 0x04, 0xAA, 0x2A, 0x00, 0x00, 0x00, 0x00, 0x01, 0xFF, 0x00, 0x00,
        ];
        want.extend([0u8; 32]);
        assert_eq!(args, want);
    }

    #[test]
    fn two_colors_packed_lsb_first() {
        let mut img = solid([255, 0, 0]);
        img.put_pixel(0, 0, Rgb([0, 0, 255]));
        let args = encode(&DynamicImage::ImageRgb8(img));
        // palette: blue (index 0) first seen, red (index 1); pixel 0 = 0, rest = 1.
        let mut want = vec![
            0x00, 0x0A, 0x0A, 0x04, 0xAA, 0x2D, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0xFF,
            0xFF, 0x00, 0x00, 0xFE,
        ];
        want.extend([0xFFu8; 31]);
        assert_eq!(args, want);
    }

    #[test]
    fn three_colors_use_two_bits() {
        let mut img = solid([0, 0, 0]);
        img.put_pixel(1, 0, Rgb([1, 1, 1])); // index 1
        img.put_pixel(2, 0, Rgb([2, 2, 2])); // index 2
        let args = encode(&DynamicImage::ImageRgb8(img));
        // header(5) + len(2) + 000000 + NN(1) + 9 palette bytes = 20, then pixels.
        // pixels 0..3 = 0,1,2,0, two bits each, LSB first: 0b00_10_01_00 = 0x24
        assert_eq!(args[10], 3);
        assert_eq!(args[20], 0x24);
        assert_eq!(args.len(), 20 + 64);
    }

    #[test]
    fn other_sizes_are_resized() {
        let big = DynamicImage::ImageRgb8(RgbImage::from_pixel(64, 64, Rgb([9, 9, 9])));
        assert_eq!(encode(&big).len(), 14 + 32);
    }

    #[test]
    fn full_packet_checksum() {
        use super::super::frame;
        let mut img = solid([255, 0, 0]);
        img.put_pixel(0, 0, Rgb([0, 0, 255]));
        let pkt = frame::encode(CMD_IMAGE, &encode(&DynamicImage::ImageRgb8(img)));
        assert_eq!(&pkt[..4], [0x01, 0x34, 0x00, 0x44]);
        assert_eq!(&pkt[pkt.len() - 3..], [0x46, 0x23, 0x02]);
    }
}
