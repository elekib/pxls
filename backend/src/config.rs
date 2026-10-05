use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub pixoo_mac: String,
    #[serde(default)]
    pub weather_location: String,
    #[serde(default)]
    pub timezone: String,
    #[serde(default)]
    pub refresh_interval_ms: u64,
    #[serde(default)]
    pub rotation_time_secs: u64,
    #[serde(default)]
    pub clock_color: String,
    #[serde(default)]
    pub date_color: String,
    #[serde(default)]
    pub weather_color: String,
    #[serde(default)]
    pub custom_pages: Vec<CustomPage>,
    #[serde(default)]
    pub device_config: DeviceConfig,
    #[serde(default)]
    pub webhooks: Vec<WebhookConfig>,
    #[serde(default)]
    pub enhanced_webhooks: Vec<crate::webhook_enhanced::EnhancedWebhookConfig>,
    /// Credentials of a dedicated Beszel user. The backend logs in with these
    /// and keeps the resulting token in memory only.
    #[serde(default)]
    pub beszel_auth: Option<BeszelAuthConfig>,
    /// Legacy pasted token. Only used as a fallback until `beszel_auth` is set;
    /// it is never refreshed or rewritten by the backend.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub beszel_token: Option<BeszelTokenConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPage {
    pub name: String,
    pub enabled: bool,
    pub page_type: PageType,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct BeszelTokenConfig {
    #[serde(default)]
    pub auth_token: String,
    #[serde(default)]
    pub last_refresh: Option<i64>, // Unix timestamp
}

// Manual Debug impls: configs get logged via tracing spans, secrets must not leak.
impl std::fmt::Debug for BeszelTokenConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BeszelTokenConfig")
            .field("auth_token", &"<redacted>")
            .field("last_refresh", &self.last_refresh)
            .finish()
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct BeszelAuthConfig {
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub password: String,
}

impl std::fmt::Debug for BeszelAuthConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BeszelAuthConfig")
            .field("email", &self.email)
            .field("password", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EnvironmentConfig {
    #[serde(default)]
    pub time_format: String, // "12h" or "24h"
    #[serde(default)]
    pub clock_design: String, // "digital" or "analog1"
    #[serde(default)]
    pub show_divoom: bool,
    #[serde(default)]
    pub show_weather: bool,
    #[serde(default)]
    pub show_temp: bool,
    #[serde(default)]
    pub show_date: bool,
    #[serde(default)]
    pub color: [u8; 3], // RGB color
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LightConfig {
    #[serde(default)]
    pub color: [u8; 3], // RGB color
    #[serde(default)]
    pub brightness: u8, // 0-100
    #[serde(default)]
    pub effect_mode: u8, // 0-4
    #[serde(default)]
    pub on: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ScoreConfig {
    #[serde(default)]
    pub red_score: u8, // 0-99
    #[serde(default)]
    pub blue_score: u8, // 0-99
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpecialConfig {
    #[serde(default)]
    pub mode: String, // specific special mode type
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MusicConfig {
    #[serde(default)]
    pub mode: String, // music visualization mode
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CountdownConfig {
    #[serde(default)]
    pub presets: Vec<CountdownPreset>,
    #[serde(default)]
    pub buzzer_active_time_ms: u16,
    #[serde(default)]
    pub buzzer_off_time_ms: u16,
    #[serde(default)]
    pub buzzer_total_time_ms: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CountdownPreset {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub minutes: u8,
    #[serde(default)]
    pub seconds: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeviceConfig {
    #[serde(default)]
    pub brightness: u8, // 0-70 (device limitation)
    #[serde(default)]
    pub time_format: String, // "12h" or "24h"
    #[serde(default)]
    pub light_mode: String, // "custom" for our pages, or native modes
    // Native mode configurations
    #[serde(default)]
    pub environment_config: EnvironmentConfig,
    #[serde(default)]
    pub light_config: LightConfig,
    #[serde(default)]
    pub score_config: ScoreConfig,
    #[serde(default)]
    pub special_config: SpecialConfig,
    #[serde(default)]
    pub music_config: MusicConfig,
    #[serde(default)]
    pub countdown_config: CountdownConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PageType {
    ClockWeather {
        clock_color: String,
        date_color: String,
        weather_color: String,
        weather_location: String,
        temperature_unit: String,
    },
    SystemStats {
        source: String, // "dashdot" or "beszel"
        dashdot_url: Option<String>,
        beszel_hub_url: Option<String>,
        beszel_system_id: Option<String>,
        brand_text: String,
        brand_color: String,
    },
    GpuStats {
        source: String, // "dashdot" or "beszel"
        dashdot_url: Option<String>,
        beszel_hub_url: Option<String>,
        beszel_system_id: Option<String>,
        brand_text: String,
        brand_color: String,
    },
    Temps {
        source: String, // "dashdot" or "beszel"
        dashdot_url: Option<String>,
        beszel_hub_url: Option<String>,
        beszel_system_id: Option<String>,
        brand_text: String,
        brand_color: String,
        show_cpu: bool,
        show_gpu: bool,
        show_storage: bool,
    },
    CustomScript {
        script_path: String,
        interval: u64,
        inputs: Vec<ScriptInput>,
    },
    ImageUpload {
        mode: String,
        frame_duration: u64,
        file_path: Option<String>,
    },
    CustomPixels {
        pixels: Vec<Pixel>,
    },
    CustomText {
        text: String,
        y: u8,
        color: String,
        background_color: String,
        scroll_speed: u64,
        enable_scroll: bool,
    },
    DivoomEnvironment {
        time_format: String,
        clock_design: String,
        show_divoom: bool,
        show_weather: bool,
        show_temp: bool,
        show_date: bool,
        color: [u8; 3],
    },
    DivoomLight {
        color: [u8; 3],
        brightness: u8,
        effect_mode: u8,
        on: bool,
    },
    DivoomSpecial {
        mode: String,
    },
    DivoomMusic {
        mode: String,
    },
    DivoomUser {
        mode: String,
    },
    DivoomScore {
        red_score: u8,
        blue_score: u8,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pixel {
    pub x: u8,
    pub y: u8,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptInput {
    pub name: String,
    pub label: String,
    pub input_type: String, // "text", "number", "color", "boolean"
    pub default_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookConfig {
    pub name: String,
    pub enabled: bool,
    pub path: String,
    pub duration_secs: u64,
    pub icon: String,
    #[serde(default)]
    pub icon_image_url: String, // URL for icon image (overrides text icon if set)
    pub title_field: String,
    pub subtitle_field: String,
    #[serde(default)]
    pub display_mode: String, // "text", "icon_only", "icon_with_text", "image"
    #[serde(default)]
    pub background_color: String, // hex like "000000" or "00FFFF"
    #[serde(default)]
    pub text_color: String, // hex like "00FFFF"
    #[serde(default)]
    pub flash: bool, // flash the screen
    #[serde(default)]
    pub flash_speed_ms: u64, // flash interval
    #[serde(default)]
    pub image_url_field: String, // field path for image URL in payload (e.g., "poster_url")
}

impl Default for WebhookConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            enabled: false,
            path: String::new(),
            duration_secs: 10,
            icon: String::new(),
            icon_image_url: String::new(),
            title_field: String::from("title"),
            subtitle_field: String::from("subtitle"),
            display_mode: String::from("text"),
            background_color: String::from("000000"),
            text_color: String::from("00FFFF"),
            flash: false,
            flash_speed_ms: 500,
            image_url_field: String::new(),
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            pixoo_mac: "".to_string(),
            weather_location: "New York,NY".to_string(),
            timezone: "America/New_York".to_string(),
            refresh_interval_ms: 1000,
            rotation_time_secs: 20,
            clock_color: "00FFFF".to_string(),
            date_color: "FFFF00".to_string(),
            weather_color: "FFA500".to_string(),
            custom_pages: vec![CustomPage {
                name: "Clock & Weather".to_string(),
                enabled: true,
                page_type: PageType::ClockWeather {
                    clock_color: "00FFFF".to_string(),
                    date_color: "FFFF00".to_string(),
                    weather_color: "FFA500".to_string(),
                    weather_location: "New York,NY".to_string(),
                    temperature_unit: "fahrenheit".to_string(),
                },
            }],
            webhooks: Vec::new(),
            enhanced_webhooks: Vec::new(),
            beszel_auth: None,
            beszel_token: None,
            device_config: DeviceConfig {
                brightness: 50,
                time_format: "12h".to_string(),
                light_mode: "custom".to_string(),
                environment_config: EnvironmentConfig {
                    time_format: "12h".to_string(),
                    clock_design: "digital".to_string(),
                    show_divoom: false,
                    show_weather: false,
                    show_temp: false,
                    show_date: true,
                    color: [255, 120, 0],
                },
                light_config: LightConfig {
                    color: [255, 255, 255],
                    brightness: 50,
                    effect_mode: 0,
                    on: true,
                },
                score_config: ScoreConfig {
                    red_score: 0,
                    blue_score: 0,
                },
                special_config: SpecialConfig {
                    mode: "default".to_string(),
                },
                music_config: MusicConfig {
                    mode: "bottom_bars".to_string(),
                },
                countdown_config: CountdownConfig {
                    presets: vec![
                        CountdownPreset {
                            name: "1 Minute".to_string(),
                            minutes: 1,
                            seconds: 0,
                        },
                        CountdownPreset {
                            name: "5 Minutes".to_string(),
                            minutes: 5,
                            seconds: 0,
                        },
                        CountdownPreset {
                            name: "15 Minutes".to_string(),
                            minutes: 15,
                            seconds: 0,
                        },
                        CountdownPreset {
                            name: "25 min (Pomodoro)".to_string(),
                            minutes: 25,
                            seconds: 0,
                        },
                    ],
                    buzzer_active_time_ms: 500,
                    buzzer_off_time_ms: 0,
                    buzzer_total_time_ms: 1000,
                },
            },
        }
    }
}

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        // Ensure data directory exists
        if !Path::new("/app/data").exists() {
            fs::create_dir_all("/app/data")?;
        }

        let config_path = "/app/data/config.json";
        if Path::new(config_path).exists() {
            let content = fs::read_to_string(config_path)?;
            let config: Config = serde_json::from_str(&content)?;

            // Migration: If enhanced_webhooks is empty but webhooks exists, migrate to database
            if config.enhanced_webhooks.is_empty() && !config.webhooks.is_empty() {
                use crate::database::WebhookDatabase;
                let db = WebhookDatabase::new("/app/data");
                if let Err(e) = db.migrate_from_config(config.webhooks.clone()) {
                    eprintln!("Failed to migrate webhooks to database: {e}");
                }
            }

            Ok(config)
        } else {
            let config = Config::default();
            config.save()?;
            Ok(config)
        }
    }

    pub fn save(&self) -> anyhow::Result<()> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;

        let content = serde_json::to_string_pretty(self)?;
        // The file holds credentials: write to a temp file with owner-only
        // permissions, then rename so a crash can't leave a truncated config.
        let tmp_path = "/app/data/config.json.tmp";
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(tmp_path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        fs::rename(tmp_path, "/app/data/config.json")?;
        Ok(())
    }

    pub fn hex_to_rgb(&self, hex: &str) -> [u8; 3] {
        let hex = hex.trim_start_matches('#');
        if hex.len() == 6 {
            [
                u8::from_str_radix(&hex[0..2], 16).unwrap_or(255),
                u8::from_str_radix(&hex[2..4], 16).unwrap_or(255),
                u8::from_str_radix(&hex[4..6], 16).unwrap_or(255),
            ]
        } else {
            [255, 255, 255]
        }
    }
}
