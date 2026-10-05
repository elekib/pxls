//! Validation for images that come from outside (uploads, fetched URLs) and
//! safe handling of stored upload filenames.

use image::ImageFormat;
use std::io::Cursor;
use std::path::{Path, PathBuf};

pub const MAX_UPLOAD_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_DIMENSION: u32 = 4096;
const MAX_PIXELS: u64 = 16 * 1024 * 1024;

/// Check the real content of an image rather than trusting its filename.
/// Returns the canonical file extension for the detected format.
pub fn validate_image_bytes(data: &[u8]) -> Result<&'static str, String> {
    let format = image::guess_format(data)
        .map_err(|_| "Not a recognised image file".to_string())?;
    let ext = match format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Gif => "gif",
        ImageFormat::Bmp => "bmp",
        ImageFormat::WebP => "webp",
        _ => return Err("Invalid file type. Allowed: PNG, JPG, GIF, BMP, WEBP".to_string()),
    };
    // Read only the header to bound memory use (decompression bombs).
    let (w, h) = image::ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|_| "Unreadable image".to_string())?
        .into_dimensions()
        .map_err(|_| "Corrupt or unsupported image".to_string())?;
    if w == 0 || h == 0 || w > MAX_DIMENSION || h > MAX_DIMENSION || (w as u64 * h as u64) > MAX_PIXELS {
        return Err(format!("Image too large (max {0}x{0})", MAX_DIMENSION));
    }
    Ok(ext)
}

/// Reduce a client-supplied filename to a safe stem: no directories, no dots
/// prefix, only `[A-Za-z0-9_-]`, bounded length.
pub fn sanitize_stem(original: &str) -> String {
    let base = original.rsplit(['/', '\\']).next().unwrap_or("");
    let stem = match base.rsplit_once('.') {
        Some((s, _ext)) if !s.is_empty() => s,
        _ => base,
    };
    let cleaned: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim_matches('_');
    let cleaned: String = cleaned.chars().take(64).collect();
    if cleaned.is_empty() { "upload".to_string() } else { cleaned }
}

/// Content type for a stored upload, by extension. Unknown types are never served as images.
pub fn content_type_for(filename: &str) -> Option<&'static str> {
    match filename.rsplit_once('.')?.1.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// Resolve `name` inside `base`, refusing anything that is not a plain file name
/// that exists directly under `base` (blocks `..`, separators, absolute paths and
/// symlinks that point outside).
pub fn resolve_upload_path(base: &Path, name: &str) -> Option<PathBuf> {
    if name.is_empty()
        || name.starts_with('.')
        || name.contains(['/', '\\', '\0'])
    {
        return None;
    }
    let canonical_base = base.canonicalize().ok()?;
    let candidate = canonical_base.join(name).canonicalize().ok()?;
    if candidate.parent() == Some(canonical_base.as_path()) && candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, RgbaImage};

    fn encode(format: ImageFormat, w: u32, h: u32) -> Vec<u8> {
        let img = DynamicImage::ImageRgba8(RgbaImage::new(w, h));
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, format).unwrap();
        out.into_inner()
    }

    #[test]
    fn accepts_real_images_and_names_the_extension() {
        assert_eq!(validate_image_bytes(&encode(ImageFormat::Png, 16, 16)), Ok("png"));
        assert_eq!(validate_image_bytes(&encode(ImageFormat::Gif, 16, 16)), Ok("gif"));
        assert_eq!(validate_image_bytes(&encode(ImageFormat::Bmp, 16, 16)), Ok("bmp"));
    }

    #[test]
    fn rejects_non_images_even_with_image_names() {
        assert!(validate_image_bytes(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>").is_err());
        assert!(validate_image_bytes(b"#!/bin/sh\nrm -rf /\n").is_err());
        assert!(validate_image_bytes(b"").is_err());
        assert!(validate_image_bytes(b"GIF89a").is_err()); // magic only, no valid header
    }

    #[test]
    fn rejects_oversized_dimensions() {
        let big = encode(ImageFormat::Png, MAX_DIMENSION + 1, 1);
        assert!(validate_image_bytes(&big).is_err());
    }

    #[test]
    fn sanitizes_filenames() {
        assert_eq!(sanitize_stem("My Photo.PNG"), "My_Photo");
        assert_eq!(sanitize_stem("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_stem("..\\..\\boot.ini"), "boot");
        assert_eq!(sanitize_stem(".hidden"), "hidden");
        assert_eq!(sanitize_stem("a<b>|c.gif"), "a_b__c");
        assert_eq!(sanitize_stem(""), "upload");
        assert_eq!(sanitize_stem("....."), "upload");
        assert_eq!(sanitize_stem(&"x".repeat(500)).len(), 64);
        assert!(!sanitize_stem("evil\0name.png").contains('\0'));
    }

    #[test]
    fn content_types_only_for_images() {
        assert_eq!(content_type_for("a.png"), Some("image/png"));
        assert_eq!(content_type_for("a.JPG"), Some("image/jpeg"));
        assert_eq!(content_type_for("a.html"), None);
        assert_eq!(content_type_for("noext"), None);
    }

    #[test]
    fn resolve_blocks_traversal_and_symlinks() {
        let root = std::env::temp_dir().join(format!("pxls-test-{}", std::process::id()));
        let uploads = root.join("uploads");
        std::fs::create_dir_all(&uploads).unwrap();
        std::fs::write(uploads.join("ok.png"), b"x").unwrap();
        std::fs::write(root.join("secret.txt"), b"s").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("secret.txt"), uploads.join("link.png")).unwrap();

        assert!(resolve_upload_path(&uploads, "ok.png").is_some());
        assert!(resolve_upload_path(&uploads, "missing.png").is_none());
        for bad in ["../secret.txt", "..", ".", "a/../ok.png", "/etc/passwd", "..\\secret.txt",
                    "%2e%2e%2fsecret.txt", ".hidden", "", "ok.png\0"] {
            assert!(resolve_upload_path(&uploads, bad).is_none(), "should reject {:?}", bad);
        }
        #[cfg(unix)]
        assert!(resolve_upload_path(&uploads, "link.png").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
