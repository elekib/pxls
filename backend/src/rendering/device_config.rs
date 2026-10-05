use pixoo::{Pixoo, Brightness, mode::TimeFormat};
use tracing::{info, warn, error, instrument};

use crate::config::DeviceConfig;
use crate::modes::divoom::apply_divoom_mode_from_config;

#[instrument(skip(pixoo))]
pub fn apply_device_config(pixoo: &mut Pixoo, device_config: &DeviceConfig) -> Result<(), Box<dyn std::error::Error>> {
    // Apply brightness (0-100, convert to library's expected range 0-255)
    let brightness_value = (device_config.brightness as f32 / 100.0 * 255.0) as u8;
    info!(brightness = device_config.brightness, brightness_value, "Setting brightness");
    
    let brightness = match Brightness::new(brightness_value) {
        Some(b) => b,
        None => {
            warn!(brightness_value, "Invalid brightness value, trying 50");
            Brightness::new(50).unwrap_or_else(|| {
                warn!("Invalid brightness value 50, trying 25");
                Brightness::new(25).unwrap_or_else(|| {
                    warn!("Using minimum brightness 1");
                    Brightness::new(1).unwrap()
                })
            })
        }
    };
    
    if let Err(e) = pixoo.set_brightness(brightness) {
        error!(error = %e, "Failed to set brightness");
        return Err(format!("Failed to set brightness: {}", e).into());
    }
    
    // Apply time format
    let time_format = match device_config.time_format.as_str() {
        "24h" => TimeFormat::TwentyfourHour,
        _ => TimeFormat::TwelveHour,
    };
    info!(time_format = %device_config.time_format, "Setting time format");
    
    if let Err(e) = pixoo.set_time_format(time_format) {
        error!(error = %e, "Failed to set time format");
        return Err(format!("Failed to set time format: {}", e).into());
    }
    
    // Apply the selected Divoom native mode immediately (env/light/special/music/
    // user/score). In "custom" mode the rendering loop drives the display, so
    // there is nothing to apply here. Applying native modes here means config
    // changes take effect instantly on save/connect instead of waiting up to
    // 10s for the rendering loop's periodic reapply.
    if device_config.light_mode != "custom" {
        if let Err(e) = apply_divoom_mode_from_config(pixoo, device_config) {
            error!(error = %e, "Failed to apply Divoom mode during device config");
            return Err(format!("Failed to apply Divoom mode: {}", e).into());
        }
    }
    
    Ok(())
}
