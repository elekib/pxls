//! Display modes (`0x45`) and the enums the app maps its config onto.
//!
//! Sources: the public Timebox Evo write-up documents `45 00` (clock),
//! `45 01` (light), `45 03` (effects), `45 04` (visualization) and
//! `45 06` (scoreboard) with their arguments. Needs device test on Pixoo:
//! the mapping of the app's "music" mode to `45 04` and the layout of
//! `45 05` ("user") are inferred, not documented.
//!
//! Music mode indexes were corrected from device observation (not from a
//! document): the order below is what the display actually shows.

pub const CMD_MODE: u8 = 0x45;

const CH_CLOCK: u8 = 0x00;
const CH_LIGHT: u8 = 0x01;
const CH_MUSIC: u8 = 0x04;
const CH_USER: u8 = 0x05;
const CH_SCORE: u8 = 0x06;

/// The scoreboard shows 0-999.
pub const MAX_SCORE: u16 = 999;

/// Brightness, 0-100 percent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Brightness(u8);

impl Brightness {
    pub fn new(percent: u8) -> Option<Self> {
        (percent <= 100).then_some(Self(percent))
    }

    pub fn from_percent(percent: u8) -> Self {
        Self(percent.min(100))
    }

    pub fn percent(self) -> u8 {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClockDesign {
    Digital = 0,
    DigitalRainbow = 1,
    DigitalBox = 2,
    Analog1 = 3,
    DigitalInverted = 4,
    Analog2 = 5,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LightEffectMode {
    Normal = 0,
    Rainbow = 1,
    Plants = 2,
    Fly = 3,
    Sleep = 4,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MusicMode {
    BottomBars = 0,
    Face3 = 1,
    CenterBars = 2,
    Face1 = 3,
    Matrix = 4,
    FrogFace = 5,
    SideBars = 6,
    Face2 = 7,
    FallingBlocks = 8,
    DancingBoy = 9,
    Fireworks = 10,
    DancingGirl = 11,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LightMode {
    Env {
        clock_design: ClockDesign,
        /// Not encoded: no documented byte for the Divoom logo.
        #[allow(dead_code)]
        show_divoom: bool,
        show_weather: bool,
        show_temp: bool,
        show_date: bool,
        color: [u8; 3],
    },
    Light {
        color: [u8; 3],
        brightness: Brightness,
        effect_mode: LightEffectMode,
        on: bool,
    },
    User,
    Music {
        mode: MusicMode,
    },
    Score {
        red_score: u16,
        blue_score: u16,
    },
}

impl LightMode {
    /// Arguments for `CMD_MODE`.
    pub fn encode(&self) -> Vec<u8> {
        match *self {
            // 45 00 01 TT time weather temp date RR GG BB; byte 3 is "fixed" in the
            // public write-up. Whether it is really a 24h flag needs device test.
            Self::Env {
                clock_design,
                show_weather,
                show_temp,
                show_date,
                color,
                ..
            } => vec![
                CH_CLOCK,
                0x01,
                clock_design as u8,
                0x01,
                u8::from(show_weather),
                u8::from(show_temp),
                u8::from(show_date),
                color[0],
                color[1],
                color[2],
            ],
            // 45 01 RR GG BB brightness effect power 00 00 00
            Self::Light {
                color,
                brightness,
                effect_mode,
                on,
            } => vec![
                CH_LIGHT,
                color[0],
                color[1],
                color[2],
                brightness.percent(),
                effect_mode as u8,
                u8::from(on),
                0x00,
                0x00,
                0x00,
            ],
            Self::User => vec![CH_USER, 0x00],
            Self::Music { mode } => vec![CH_MUSIC, mode as u8],
            // 45 06 00 RED(le16) BLUE(le16)
            Self::Score {
                red_score,
                blue_score,
            } => {
                let r = red_score.min(MAX_SCORE).to_le_bytes();
                let b = blue_score.min(MAX_SCORE).to_le_bytes();
                vec![CH_SCORE, 0x00, r[0], r[1], b[0], b[1]]
            }
        }
    }
}
