//! Tool commands: stopwatch, noise meter, countdown and the scoreboard tool.
//!
//! Layouts for stopwatch, noise and countdown come from this repo's
//! docs/protocol.md (command `0x72`). The scoreboard tool (`0x50`, an `on`
//! flag plus two 16-bit scores) comes from the existing wrapper's description
//! of the app's behavior. None of these appear in the public Timebox write-ups.
//! All need device test.

pub const CMD_TOOL: u8 = 0x72;
pub const CMD_SCORE_TOOL: u8 = 0x50;

const TOOL_TIMER: u8 = 0x00;
const TOOL_NOISE: u8 = 0x02;
const TOOL_COUNTDOWN: u8 = 0x03;

/// Seconds, 0-59.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Seconds(u8);

impl Seconds {
    pub fn new(value: u8) -> Option<Self> {
        (value < 60).then_some(Self(value))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimerControl {
    Start,
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoiseControl {
    Start,
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CountDownControl {
    Start,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolInfo {
    Timer(TimerControl),
    Noise(NoiseControl),
    CountDown {
        control: CountDownControl,
        minutes: u8,
        seconds: Seconds,
    },
    Score {
        on: bool,
        red_score: u16,
        blue_score: u16,
    },
}

impl ToolInfo {
    /// Command byte and arguments.
    pub fn encode(&self) -> (u8, Vec<u8>) {
        match *self {
            Self::Timer(c) => (
                CMD_TOOL,
                vec![TOOL_TIMER, u8::from(c == TimerControl::Start)],
            ),
            Self::Noise(c) => (
                CMD_TOOL,
                vec![TOOL_NOISE, u8::from(c == NoiseControl::Start)],
            ),
            Self::CountDown {
                control,
                minutes,
                seconds,
            } => (
                CMD_TOOL,
                vec![
                    TOOL_COUNTDOWN,
                    u8::from(control == CountDownControl::Start),
                    minutes,
                    seconds.0,
                ],
            ),
            Self::Score {
                on,
                red_score,
                blue_score,
            } => {
                let r = red_score.min(super::mode::MAX_SCORE).to_le_bytes();
                let b = blue_score.min(super::mode::MAX_SCORE).to_le_bytes();
                (CMD_SCORE_TOOL, vec![u8::from(on), r[0], r[1], b[0], b[1]])
            }
        }
    }
}
