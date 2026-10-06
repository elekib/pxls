use crate::device::transport::Transport;
use crate::device::{Brightness, Pixoo, TimeFormat};
use tracing::{error, info, instrument, warn};

use crate::config::DeviceConfig;
use crate::modes::divoom::apply_divoom_mode_from_config;

#[instrument(skip(pixoo))]
pub fn apply_device_config<T: Transport>(
    pixoo: &mut Pixoo<T>,
    device_config: &DeviceConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    // Apply brightness (0-100 percent, the device's native range)
    let brightness = Brightness::from_percent(device_config.brightness);
    info!(brightness = device_config.brightness, "Setting brightness");

    if let Err(e) = pixoo.set_brightness(brightness) {
        error!(error = %e, "Failed to set brightness");
        return Err(format!("Failed to set brightness: {e}").into());
    }

    // Apply time format
    let time_format = match device_config.time_format.as_str() {
        "24h" => TimeFormat::TwentyfourHour,
        _ => TimeFormat::TwelveHour,
    };
    info!(time_format = %device_config.time_format, "Setting time format");

    if let Err(e) = pixoo.set_time_format(time_format) {
        error!(error = %e, "Failed to set time format");
        return Err(format!("Failed to set time format: {e}").into());
    }

    // Apply the selected Divoom native mode immediately (env/light/special/music/
    // user/score). In "custom" mode the rendering loop drives the display, so
    // there is nothing to apply here. Applying native modes here means config
    // changes take effect instantly on save/connect instead of waiting up to
    // 10s for the rendering loop's periodic reapply.
    if device_config.light_mode != "custom" {
        if let Err(e) = apply_divoom_mode_from_config(pixoo, device_config) {
            error!(error = %e, "Failed to apply Divoom mode during device config");
            return Err(format!("Failed to apply Divoom mode: {e}").into());
        }
    }

    Ok(())
}
