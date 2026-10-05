use crate::config::Config;
use crate::renderer::Renderer;
use anyhow::Result;
use chrono::{Local, Timelike};
use image::{DynamicImage, GenericImage, Rgba};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::{debug, info, trace, warn};

pub struct ClockWeatherPage;

struct WeatherCache {
    temp: String,
    weathercode: i64,
    location: String,
    unit: String,
    last_update: Instant,
}

static WEATHER_CACHE: Mutex<Option<Arc<WeatherCache>>> = Mutex::new(None);
static ICON_ANIMATION: Mutex<IconAnimation> = Mutex::new(IconAnimation {
    last_frame: 0,
    last_update: None,
});
const WEATHER_CACHE_DURATION: Duration = Duration::from_secs(600); // 10 minutes
const ICON_FRAME_DURATION: Duration = Duration::from_millis(333); // 3 FPS animation

struct IconAnimation {
    last_frame: usize,
    last_update: Option<Instant>,
}

impl ClockWeatherPage {
    pub fn render(
        clock_color: &str,
        date_color: &str,
        weather_color: &str,
        weather_location: &str,
        temperature_unit: &str,
    ) -> Result<DynamicImage> {
        let mut img = DynamicImage::new_rgba8(16, 16);
        Renderer::clear_screen(&mut img);

        let now = Local::now();

        // Get cached weather or fetch new data
        let (temp, weathercode) = Self::get_weather(weather_location, temperature_unit);

        // Render time components separately to avoid spacing issues
        let hour = now.format("%-I").to_string();
        let minute = now.format("%M").to_string();

        // Render date components separately
        let month_abbr = now.format("%b").to_string();
        let day_two_digit = now.format("%d").to_string();

        debug!(hour = %hour, minute = %minute, date = %format!("{}{}", month_abbr, day_two_digit), temp = %temp, second = now.second(), "Rendering clock/weather page");

        let config = Config::default();
        let clock_rgb = config.hex_to_rgb(clock_color);
        let date_rgb = config.hex_to_rgb(date_color);
        let weather_rgb = config.hex_to_rgb(weather_color);

        // Draw hour
        Renderer::draw_text(&mut img, &hour, 0, 0, clock_rgb, 1);
        // Draw colon at position after hour (hour is variable width: 1 or 2 chars)
        // Blink the colon every second
        let hour_width = hour.len() as i32 * 4 - 1; // Approximate width
        if now.second().is_multiple_of(2) {
            Renderer::draw_text(&mut img, ":", hour_width, 0, clock_rgb, 1);
        }
        // Draw minute after colon
        Renderer::draw_text(&mut img, &minute, hour_width + 1, 0, clock_rgb, 1);

        // Draw date: month abbreviation (3 chars) + day (2 digits) - compact to fit in 16px
        Renderer::draw_text(&mut img, &month_abbr, 0, 5, date_rgb, 0);
        // Draw day right after month (3px per char with spacing=0)
        let month_width = month_abbr.len() as i32 * 3;
        Renderer::draw_text(&mut img, &day_two_digit, month_width, 5, date_rgb, 1);

        let temp_clean = temp.trim();
        let temp_str = if temp_clean.is_empty() || temp_clean == "??" || temp_clean == "--" {
            "--".to_string()
        } else {
            temp_clean.to_string()
        };

        // Draw temperature and degree symbol separately to avoid spacing
        let temp_width = temp_str.len() as i32 * 4 - 1;
        Renderer::draw_text(&mut img, &temp_str, 0, 11, weather_rgb, 1);
        // Draw degree symbol right after temperature
        Renderer::draw_text(&mut img, "*", temp_width + 1, 11, weather_rgb, 0);

        // Draw weather icon (5x5) next to temperature if we have valid weather
        if weathercode >= 0 && temp_str != "--" {
            let frame = Self::get_animation_frame();
            Self::draw_weather_icon(&mut img, weathercode, temp_width + 3, 11, frame);
        }

        Ok(img)
    }

    fn get_weather(location: &str, unit: &str) -> (String, i64) {
        // Check cache first
        if let Ok(cache_guard) = WEATHER_CACHE.lock() {
            if let Some(cache) = cache_guard.as_ref() {
                if cache.location == location
                    && cache.unit == unit
                    && cache.last_update.elapsed() < WEATHER_CACHE_DURATION
                {
                    return (cache.temp.clone(), cache.weathercode);
                }
            }
        }

        // Fetch new weather data
        let (temp, _, _, weathercode) = Self::fetch_weather(location, unit);

        // Update cache
        if let Ok(mut cache_guard) = WEATHER_CACHE.lock() {
            *cache_guard = Some(Arc::new(WeatherCache {
                temp: temp.clone(),
                weathercode,
                location: location.to_string(),
                unit: unit.to_string(),
                last_update: Instant::now(),
            }));
        }

        (temp, weathercode)
    }

    fn get_animation_frame() -> usize {
        if let Ok(mut anim) = ICON_ANIMATION.lock() {
            let now = Instant::now();
            if let Some(last) = anim.last_update {
                if now.duration_since(last) >= ICON_FRAME_DURATION {
                    anim.last_frame = (anim.last_frame + 1) % 3;
                    anim.last_update = Some(now);
                }
            } else {
                anim.last_update = Some(now);
            }
            return anim.last_frame;
        }
        0
    }

    fn fetch_weather(location: &str, unit: &str) -> (String, String, String, i64) {
        // Extract just the city name (before comma) for geocoding
        let city = location.split(',').next().unwrap_or(location).trim();
        let geocode_url = format!(
            "https://geocoding-api.open-meteo.com/v1/search?name={}&count=1&language=en&format=json",
            urlencoding::encode(city)
        );

        debug!(url = %geocode_url, "Fetching geocoding data");

        // Fetch geocoding data
        let response = match reqwest::blocking::get(&geocode_url) {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "Failed to fetch geocoding data");
                return ("--".into(), "?".into(), "--".into(), -1);
            }
        };

        let json: serde_json::Value = match response.json() {
            Ok(j) => {
                debug!(response = %serde_json::to_string_pretty(&j).unwrap_or_default(), "Geocoding response");
                j
            }
            Err(e) => {
                warn!(error = %e, "Failed to parse geocoding JSON");
                return ("--".into(), "?".into(), "--".into(), -1);
            }
        };

        let results = match json.get("results").and_then(|r| r.as_array()) {
            Some(r) if !r.is_empty() => r,
            _ => {
                warn!(city = %city, "No geocoding results for city");
                return ("--".into(), "?".into(), "--".into(), -1);
            }
        };

        let first = &results[0];
        let lat = first
            .get("latitude")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let lon = first
            .get("longitude")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let name = first
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown");

        info!(location = %name, lat, lon, "Resolved location for weather");

        // Fetch weather
        let unit_param = if unit == "celsius" {
            "celsius"
        } else {
            "fahrenheit"
        };

        let weather_url = format!(
            "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&current_weather=true&temperature_unit={}",
            lat, lon, unit_param
        );
        debug!(url = %weather_url, "Fetching weather data");

        let w_response = match reqwest::blocking::get(&weather_url) {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "Failed to fetch weather data");
                return ("--".into(), "?".into(), "--".into(), -1);
            }
        };

        let w_json: serde_json::Value = match w_response.json() {
            Ok(j) => {
                debug!(response = %serde_json::to_string_pretty(&j).unwrap_or_default(), "Weather response");
                j
            }
            Err(e) => {
                warn!(error = %e, "Failed to parse weather JSON");
                return ("--".into(), "?".into(), "--".into(), -1);
            }
        };

        let current = w_json.get("current_weather");

        let temp = current
            .and_then(|c| c.get("temperature"))
            .and_then(|v| v.as_f64())
            .map_or_else(
                || {
                    debug!("No temperature in weather response");
                    "--".to_string()
                },
                |t| {
                    let temp_str = format!("{:.0}", t);
                    debug!(temp = %temp_str, "Got temperature from weather API");
                    temp_str
                },
            );

        let weathercode = current
            .and_then(|c| c.get("weathercode"))
            .and_then(|v| v.as_i64())
            .unwrap_or(-1);

        let condition = if temp != "--" { "ok" } else { "?" };
        info!(temp = %temp, weathercode, condition, "Weather data resolved");

        (temp, condition.into(), "--".into(), weathercode)
    }

    fn draw_weather_icon(img: &mut DynamicImage, code: i64, x: i32, y: i32, frame: usize) {
        debug!(code, x, y, frame, "Drawing weather icon");
        // Fixed colors for each weather type
        let white: [u8; 3] = [255, 255, 255]; // Clouds
        let yellow: [u8; 3] = [255, 200, 0]; // Sun
        let orange: [u8; 3] = [255, 140, 0]; // Sun core/partly
        let blue: [u8; 3] = [0, 150, 255]; // Rain drops
        let light_blue: [u8; 3] = [200, 220, 255]; // Snow
        let purple: [u8; 3] = [180, 0, 255]; // Lightning
        let gray: [u8; 3] = [180, 180, 180]; // Fog/cloudy

        // Get icon data and colors for this weather condition
        #[allow(clippy::type_complexity)]
        let (cloud_icon, sun_icon, drop_icon, colors): (
            [u8; 5],
            Option<[u8; 5]>,
            Option<[u8; 5]>,
            [&[u8; 3]; 5],
        ) = match code {
            // Clear/Sunny (0) - animated sun with pulsing rays
            0 => {
                let sun_rays = [
                    [0b10001, 0b01010, 0b00100, 0b01010, 0b10001], // frame 0
                    [0b01010, 0b00100, 0b01110, 0b00100, 0b01010], // frame 1 - rays longer
                    [0b10001, 0b01010, 0b00100, 0b01010, 0b10001], // frame 2
                ];
                let sun_cores = [
                    [0b00000, 0b00100, 0b01110, 0b00100, 0b00000], // small
                    [0b00000, 0b01110, 0b01110, 0b01110, 0b00000], // medium
                    [0b00000, 0b00100, 0b01110, 0b00100, 0b00000], // small
                ];
                let f = frame % 3;
                (
                    sun_rays[f],
                    Some(sun_cores[f]),
                    None,
                    [&yellow, &yellow, &orange, &orange, &orange],
                )
            }
            // Partly cloudy (1-3) - cloud with animated sun behind (sun is a small circle)
            1..=3 => {
                let sun_pos = [
                    [0b00110, 0b01110, 0b01100, 0b00000, 0b00000], // circle top right
                    [0b00011, 0b00111, 0b00110, 0b00000, 0b00000], // circle shifting
                    [0b00110, 0b01110, 0b01100, 0b00000, 0b00000],
                ];
                let cloud = [0b00110, 0b01111, 0b11111, 0b11111, 0b01100];
                (
                    cloud,
                    Some(sun_pos[frame % 3]),
                    None,
                    [&white, &white, &white, &yellow, &yellow],
                )
            }
            // Cloudy/Fog (45, 48) - shifting cloud layers
            45 | 48 => {
                let clouds = [
                    [0b00100, 0b01110, 0b11111, 0b11111, 0b01010],
                    [0b00010, 0b00111, 0b11111, 0b11111, 0b10100], // shifting left
                    [0b01000, 0b01110, 0b11111, 0b11111, 0b01010], // shifting right
                ];
                (
                    clouds[frame % 3],
                    None,
                    None,
                    [&gray, &gray, &gray, &gray, &gray],
                )
            }
            // Drizzle/Rain (51-65) - cloud with falling drops below it
            51..=65 => {
                let drops = [
                    [0b00000, 0b00000, 0b00000, 0b10101, 0b00000], // frame 0 - 3 drops just below cloud
                    [0b00000, 0b00000, 0b00000, 0b00000, 0b10101], // frame 1 - drops fell
                    [0b00000, 0b00000, 0b00000, 0b01010, 0b00000], // frame 2 - middle drop falling
                ];
                let cloud = [0b01110, 0b11111, 0b11111, 0b00000, 0b00000];
                (
                    cloud,
                    None,
                    Some(drops[frame % 3]),
                    [&white, &white, &white, &blue, &blue],
                )
            }
            // Snow (71-77) - snowflakes falling from cloud
            71..=77 => {
                let flakes = [
                    [0b00000, 0b00000, 0b00000, 0b01010, 0b00000], // frame 0 - flakes at row 3
                    [0b00000, 0b00000, 0b00000, 0b00000, 0b01010], // frame 1 - flakes at row 4
                    [0b00000, 0b00000, 0b00000, 0b00100, 0b00000], // frame 2 - single flake middle
                ];
                let cloud = [0b01110, 0b11111, 0b11111, 0b00000, 0b00000];
                (
                    cloud,
                    None,
                    Some(flakes[frame % 3]),
                    [&white, &white, &white, &light_blue, &light_blue],
                )
            }
            // Thunderstorm (95-99) - flashing lightning
            95..=99 => {
                let lightning = [
                    [0b00000, 0b00010, 0b00110, 0b01100, 0b01000], // bolt
                    [0b00000, 0b00000, 0b00110, 0b00000, 0b00000], // flash dim
                    [0b00000, 0b00010, 0b00110, 0b01100, 0b01000], // bolt again
                ];
                let cloud = [0b01110, 0b11111, 0b11111, 0b00000, 0b00000];
                (
                    cloud,
                    None,
                    Some(lightning[frame % 3]),
                    [&white, &white, &white, &purple, &purple],
                )
            }
            // Default (cloud)
            _ => (
                [0b00100, 0b01110, 0b11111, 0b11111, 0b01010],
                None,
                None,
                [&white, &white, &white, &white, &white],
            ),
        };

        // Draw cloud/base layer
        Self::draw_icon_layer(img, x, y, cloud_icon, colors[0]);

        // Draw sun layer if present
        if let Some(sun) = sun_icon {
            Self::draw_icon_layer(img, x, y, sun, colors[3]);
        }

        // Draw drops/flakes/lightning if present
        if let Some(drops) = drop_icon {
            Self::draw_icon_layer(img, x, y, drops, colors[3]);
        }
    }

    fn draw_icon_layer(img: &mut DynamicImage, x: i32, y: i32, icon: [u8; 5], color: &[u8; 3]) {
        let pixel_count = 0;
        for (row_idx, row_bits) in icon.iter().enumerate() {
            for col_idx in 0..5 {
                if (row_bits >> (4 - col_idx)) & 1 == 1 {
                    let px = x + col_idx;
                    let py = y + row_idx as i32;
                    if (0..16).contains(&px) && (0..16).contains(&py) {
                        img.put_pixel(
                            px as u32,
                            py as u32,
                            Rgba([color[0], color[1], color[2], 255]),
                        );
                    }
                }
            }
        }
        if pixel_count > 0 {
            trace!(pixel_count, x, y, "Drew icon pixels");
        }
    }
}
