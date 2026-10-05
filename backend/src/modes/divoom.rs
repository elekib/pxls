use pixoo::{
    mode::{LightMode, TimeFormat},
    Brightness, Pixoo,
};
use tracing::info;

use crate::config::{CustomPage, DeviceConfig, PageType};

pub fn is_divoom_page_type(page_type: &PageType) -> bool {
    matches!(
        page_type,
        PageType::DivoomEnvironment { .. }
            | PageType::DivoomLight { .. }
            | PageType::DivoomSpecial { .. }
            | PageType::DivoomMusic { .. }
            | PageType::DivoomUser { .. }
            | PageType::DivoomScore { .. }
    )
}

pub fn apply_divoom_mode_from_config(
    pixoo: &mut Pixoo,
    device_config: &DeviceConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    match device_config.light_mode.as_str() {
        "env" => {
            let env_config = &device_config.environment_config;
            let tf = match env_config.time_format.as_str() {
                "24h" => TimeFormat::TwentyfourHour,
                _ => TimeFormat::TwelveHour,
            };

            let cd = match env_config.clock_design.as_str() {
                "digital" => pixoo::mode::ClockDesign::Digital,
                "digital_rainbow" => pixoo::mode::ClockDesign::DigitalRainbow,
                "digital_box" => pixoo::mode::ClockDesign::DigitalBox,
                "analog1" => pixoo::mode::ClockDesign::Analog1,
                "digital_inverted" => pixoo::mode::ClockDesign::DigitalInverted,
                "analog2" => pixoo::mode::ClockDesign::Analog2,
                _ => pixoo::mode::ClockDesign::Digital,
            };

            let light_mode = LightMode::Env {
                time_format: tf,
                clock_design: cd,
                show_divoom: env_config.show_divoom,
                show_weather: env_config.show_weather,
                show_temp: env_config.show_temp,
                show_date: env_config.show_date,
                color: env_config.color,
            };
            pixoo.set_mode(light_mode)?;
        }
        "light" => {
            let light_config = &device_config.light_config;
            let brightness_value = (light_config.brightness as f32 / 100.0 * 255.0) as u8;
            let brightness = match Brightness::new(brightness_value) {
                Some(b) => b,
                None => {
                    tracing::warn!(brightness_value, "Invalid brightness value, trying 50");
                    Brightness::new(50).unwrap_or_else(|| {
                        tracing::warn!("Invalid brightness value 50, trying 25");
                        Brightness::new(25).unwrap_or_else(|| {
                            tracing::warn!("Using minimum brightness 1");
                            Brightness::new(1).unwrap()
                        })
                    })
                }
            };

            let effect_mode = match light_config.effect_mode {
                0 => pixoo::mode::LightEffectMode::Normal,
                1 => pixoo::mode::LightEffectMode::Rainbow,
                2 => pixoo::mode::LightEffectMode::Plants,
                3 => pixoo::mode::LightEffectMode::Fly,
                4 => pixoo::mode::LightEffectMode::Sleep,
                _ => pixoo::mode::LightEffectMode::Normal,
            };

            let light_mode = LightMode::Light {
                color: light_config.color,
                brightness,
                effect_mode,
                on: light_config.on,
            };
            pixoo.set_mode(light_mode)?;
            info!(
                brightness = light_config.brightness,
                effect = light_config.effect_mode,
                "Light mode applied"
            );
        }
        "user" => {
            pixoo.set_mode(LightMode::User)?;
            info!("User mode activated");
        }
        "special" => {
            let special_config = &device_config.special_config;
            let mode_value = match special_config.mode.as_str() {
                "default" => 0,
                "sparkle" => 1,
                "breath" => 2,
                "wave" => 3,
                _ => 0,
            };
            let light_mode = LightMode::Special { mode: mode_value };
            pixoo.set_mode(light_mode)?;
            info!(mode = %special_config.mode, "Special mode activated");
        }
        "music" => {
            let music_config = &device_config.music_config;
            let music_mode = match music_config.mode.as_str() {
                "bottom_bars" => pixoo::mode::MusicMode::BottomBars,
                "center_bars" => pixoo::mode::MusicMode::CenterBars,
                "side_bars" => pixoo::mode::MusicMode::SideBars,
                "face1" => pixoo::mode::MusicMode::Face1,
                "face2" => pixoo::mode::MusicMode::Face2,
                "face3" => pixoo::mode::MusicMode::Face3,
                "frog_face" => pixoo::mode::MusicMode::FrogFace,
                "matrix" => pixoo::mode::MusicMode::Matrix,
                "falling_blocks" => pixoo::mode::MusicMode::FallingBlocks,
                "fireworks" => pixoo::mode::MusicMode::Fireworks,
                "dancing_boy" => pixoo::mode::MusicMode::DancingBoy,
                "dancing_girl" => pixoo::mode::MusicMode::DancingGirl,
                _ => pixoo::mode::MusicMode::BottomBars,
            };
            let light_mode = LightMode::Music { mode: music_mode };
            pixoo.set_mode(light_mode)?;
            info!(mode = %music_config.mode, "Music mode activated");
        }
        "score" => {
            let score_config = &device_config.score_config;
            let light_mode = LightMode::Score {
                red_score: score_config.red_score,
                blue_score: score_config.blue_score,
            };
            pixoo.set_mode(light_mode)?;
            info!(
                red = score_config.red_score,
                blue = score_config.blue_score,
                "Score mode activated"
            );
        }
        _ => {
            return Ok(());
        }
    }
    Ok(())
}

pub fn apply_divoom_mode(
    pixoo: &mut Pixoo,
    page: &CustomPage,
) -> Result<(), Box<dyn std::error::Error>> {
    match &page.page_type {
        PageType::DivoomEnvironment {
            time_format,
            clock_design,
            show_divoom,
            show_weather,
            show_temp,
            show_date,
            color,
        } => {
            let tf = match time_format.as_str() {
                "24h" => TimeFormat::TwentyfourHour,
                _ => TimeFormat::TwelveHour,
            };

            let cd = match clock_design.as_str() {
                "digital" => pixoo::mode::ClockDesign::Digital,
                "digital_rainbow" => pixoo::mode::ClockDesign::DigitalRainbow,
                "digital_box" => pixoo::mode::ClockDesign::DigitalBox,
                "analog1" => pixoo::mode::ClockDesign::Analog1,
                "digital_inverted" => pixoo::mode::ClockDesign::DigitalInverted,
                "analog2" => pixoo::mode::ClockDesign::Analog2,
                _ => pixoo::mode::ClockDesign::Digital,
            };

            let light_mode = LightMode::Env {
                time_format: tf,
                clock_design: cd,
                show_divoom: *show_divoom,
                show_weather: *show_weather,
                show_temp: *show_temp,
                show_date: *show_date,
                color: *color,
            };
            pixoo.set_mode(light_mode)?;
        }
        PageType::DivoomLight {
            color,
            brightness,
            effect_mode,
            on,
        } => {
            let brightness_value = (*brightness as f32 / 100.0 * 255.0) as u8;
            let bounded = match Brightness::new(brightness_value) {
                Some(b) => b,
                None => {
                    tracing::warn!(brightness_value, "Invalid light page brightness, trying 50");
                    Brightness::new(50).unwrap_or_else(|| {
                        tracing::warn!("Invalid brightness value 50, trying 25");
                        Brightness::new(25).unwrap_or_else(|| {
                            tracing::warn!("Using minimum brightness 1");
                            Brightness::new(1).unwrap()
                        })
                    })
                }
            };

            let effect = match *effect_mode {
                0 => pixoo::mode::LightEffectMode::Normal,
                1 => pixoo::mode::LightEffectMode::Rainbow,
                2 => pixoo::mode::LightEffectMode::Plants,
                3 => pixoo::mode::LightEffectMode::Fly,
                4 => pixoo::mode::LightEffectMode::Sleep,
                _ => pixoo::mode::LightEffectMode::Normal,
            };

            let light_mode = LightMode::Light {
                color: *color,
                brightness: bounded,
                effect_mode: effect,
                on: *on,
            };
            pixoo.set_mode(light_mode)?;
            info!(
                brightness = *brightness,
                effect = *effect_mode,
                on = *on,
                "Light page mode applied"
            );
        }
        PageType::DivoomSpecial { mode } => {
            let mode_value = match mode.as_str() {
                "default" => 0,
                "sparkle" => 1,
                "breath" => 2,
                "wave" => 3,
                _ => 0,
            };
            pixoo.set_mode(LightMode::Special { mode: mode_value })?;
            info!(mode = %mode, "Special page mode applied");
        }
        PageType::DivoomMusic { mode } => {
            let music_mode = match mode.as_str() {
                "bottom_bars" => pixoo::mode::MusicMode::BottomBars,
                "center_bars" => pixoo::mode::MusicMode::CenterBars,
                "side_bars" => pixoo::mode::MusicMode::SideBars,
                "face1" => pixoo::mode::MusicMode::Face1,
                "face2" => pixoo::mode::MusicMode::Face2,
                "face3" => pixoo::mode::MusicMode::Face3,
                "frog_face" => pixoo::mode::MusicMode::FrogFace,
                "matrix" => pixoo::mode::MusicMode::Matrix,
                "falling_blocks" => pixoo::mode::MusicMode::FallingBlocks,
                "fireworks" => pixoo::mode::MusicMode::Fireworks,
                "dancing_boy" => pixoo::mode::MusicMode::DancingBoy,
                "dancing_girl" => pixoo::mode::MusicMode::DancingGirl,
                _ => pixoo::mode::MusicMode::BottomBars,
            };
            pixoo.set_mode(LightMode::Music { mode: music_mode })?;
            info!(mode = %mode, "Music page mode applied");
        }
        PageType::DivoomUser { mode: _ } => {
            pixoo.set_mode(LightMode::User)?;
            info!("User page mode activated");
        }
        PageType::DivoomScore {
            red_score,
            blue_score,
        } => {
            pixoo.set_mode(LightMode::Score {
                red_score: *red_score,
                blue_score: *blue_score,
            })?;
            info!(
                red = red_score,
                blue = blue_score,
                "Score page mode applied"
            );
        }
        _ => {
            return Ok(());
        }
    }
    Ok(())
}
