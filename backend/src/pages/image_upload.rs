use crate::renderer::Renderer;
use anyhow::Result;
use image::{AnimationDecoder, DynamicImage};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::{debug, warn};

/// Cached animated GIF data with native frame timing
struct AnimatedGif {
    frames: Vec<DynamicImage>,
    frame_delays: Vec<Duration>, // Native delays from GIF file
    use_native_timing: bool,     // If true, use frame_delays; if false, use fixed duration
    fixed_duration: Duration,    // User-specified duration (when use_native_timing is false)
}

/// Global cache for decoded GIFs
use once_cell::sync::Lazy;

static GIF_CACHE: Lazy<Mutex<HashMap<String, Arc<AnimatedGif>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Track which GIF is currently being displayed per file
static ACTIVE_GIFS: Lazy<Mutex<HashMap<String, Instant>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub struct ImageUploadPage;

impl ImageUploadPage {
    pub fn render(
        mode: &str,
        file_path: Option<&str>,
        frame_duration_ms: u64,
    ) -> Result<DynamicImage> {
        debug!(mode = %mode, file_path = ?file_path, "Rendering image upload page");

        // If no file is uploaded, show placeholder
        let path = match file_path {
            Some(p) if !p.is_empty() => p,
            _ => {
                let mut img = DynamicImage::new_rgba8(16, 16);
                Renderer::clear_screen(&mut img);
                let label = if mode == "animated" { "GIF" } else { "IMG" };
                Renderer::draw_text(&mut img, label, 4, 6, [100, 100, 100], 0);
                return Ok(img);
            }
        };

        let full_path = match crate::image_guard::resolve_upload_path(
            Path::new(crate::routes::upload::UPLOADS_DIR),
            path,
        ) {
            Some(p) => p.to_string_lossy().into_owned(),
            None => {
                warn!("Uploaded file not found or invalid: {}", path);
                let mut img = DynamicImage::new_rgba8(16, 16);
                Renderer::clear_screen(&mut img);
                Renderer::draw_text(&mut img, "?", 7, 6, [255, 0, 0], 0);
                return Ok(img);
            }
        };

        // Check if this is a GIF and animated mode
        let is_gif = path.to_lowercase().ends_with(".gif");
        let is_animated = mode == "animated";

        if is_gif && is_animated {
            // Handle animated GIF
            Self::render_animated_gif(&full_path, path, frame_duration_ms)
        } else {
            // Handle static image (single frame)
            Self::render_static_image(&full_path)
        }
    }

    fn render_static_image(full_path: &str) -> Result<DynamicImage> {
        match image::open(full_path) {
            Ok(img) => {
                let resized = img.resize_exact(16, 16, image::imageops::FilterType::Lanczos3);
                Ok(resized)
            }
            Err(e) => {
                warn!("Failed to load image {}: {}", full_path, e);
                let mut img = DynamicImage::new_rgba8(16, 16);
                Renderer::clear_screen(&mut img);
                Renderer::draw_text(&mut img, "ERR", 3, 6, [255, 0, 0], 0);
                Ok(img)
            }
        }
    }

    fn render_animated_gif(
        full_path: &str,
        cache_key: &str,
        frame_duration_ms: u64,
    ) -> Result<DynamicImage> {
        // Try to get cached GIF or load it
        let gif = {
            let cache = GIF_CACHE.lock().unwrap();
            cache.get(cache_key).cloned()
        };

        let gif = match gif {
            Some(g) => g,
            None => {
                // Load and decode the GIF
                match Self::load_gif_frames(full_path, frame_duration_ms) {
                    Ok((frames, frame_delays, use_native_timing)) => {
                        let gif = Arc::new(AnimatedGif {
                            frames,
                            frame_delays,
                            use_native_timing,
                            fixed_duration: Duration::from_millis(frame_duration_ms),
                        });
                        let mut cache = GIF_CACHE.lock().unwrap();
                        cache.insert(cache_key.to_string(), gif.clone());
                        gif
                    }
                    Err(e) => {
                        warn!("Failed to decode GIF {}: {}", full_path, e);
                        return Self::render_static_image(full_path);
                    }
                }
            }
        };

        // Calculate which frame to show based on elapsed time
        let mut active = ACTIVE_GIFS.lock().unwrap();
        let start_time = *active
            .entry(cache_key.to_string())
            .or_insert_with(Instant::now);
        let elapsed = start_time.elapsed();

        let frame_index = if gif.use_native_timing {
            // Use native frame delays from GIF file
            let total_duration: Duration = gif.frame_delays.iter().sum();
            let looped_elapsed_ms = elapsed.as_millis() % total_duration.as_millis();

            // Find which frame we're on based on cumulative delays
            let mut cumulative_ms: u128 = 0;
            let mut index = 0;
            for (i, delay) in gif.frame_delays.iter().enumerate() {
                cumulative_ms += delay.as_millis();
                if looped_elapsed_ms < cumulative_ms {
                    index = i;
                    break;
                }
            }
            index
        } else {
            // Use fixed frame duration specified by user
            let total_duration = gif.fixed_duration * gif.frames.len() as u32;
            let looped_elapsed = elapsed.as_millis() % total_duration.as_millis();
            (looped_elapsed / gif.fixed_duration.as_millis() as u128) as usize % gif.frames.len()
        };

        // Return the appropriate frame (already resized)
        Ok(gif.frames[frame_index].clone())
    }

    fn load_gif_frames(
        full_path: &str,
        frame_duration_ms: u64,
    ) -> Result<(Vec<DynamicImage>, Vec<Duration>, bool)> {
        let file = std::fs::File::open(full_path)?;
        let reader = std::io::BufReader::new(file);
        let decoder = image::codecs::gif::GifDecoder::new(reader)?;

        let mut frames = Vec::new();
        let mut frame_delays = Vec::new();

        // Collect all frames and their native delays
        for frame_result in decoder.into_frames() {
            let frame = frame_result?;
            // Get the native delay for this frame (convert from frame.delay() which is in "ticks")
            // GIF format uses centiseconds (1/100th of a second) for delays
            let delay_cs = frame.delay().numer_denom_ms().0 / 10; // Convert ms to centiseconds approximation
            let delay_ms = if delay_cs == 0 {
                100 // Default to 100ms if delay is 0 (common in some GIFs)
            } else {
                delay_cs as u64
            };
            let delay = Duration::from_millis(delay_ms);
            frame_delays.push(delay);

            let buffer = frame.into_buffer();
            let img = DynamicImage::ImageRgba8(buffer);
            let resized = img.resize_exact(16, 16, image::imageops::FilterType::Lanczos3);
            frames.push(resized);
        }

        if frames.is_empty() {
            return Err(anyhow::anyhow!("No frames found in GIF"));
        }

        // Use native timing if frame_duration_ms is 0, otherwise use user-specified duration
        let use_native_timing = frame_duration_ms == 0;

        debug!(
            "Loaded {} frames from GIF, use_native_timing={}, avg_delay={}ms",
            frames.len(),
            use_native_timing,
            frame_delays.iter().map(|d| d.as_millis()).sum::<u128>() / frame_delays.len() as u128
        );

        Ok((frames, frame_delays, use_native_timing))
    }
}
