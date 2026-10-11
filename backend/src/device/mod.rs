//! pxls's own Bluetooth driver for Divoom Pixoo displays.
//!
//! Written from `docs/protocol.md`, public protocol write-ups and observed
//! application behavior. Every command's source and verification status is
//! listed in `docs/protocol.md`; anything marked "needs device test" has not
//! been confirmed against real hardware.
//!
//! This module only refers to itself (`super::`, never `crate::`) so the
//! examples can include it with `#[path]`.

pub mod frame;
pub mod image;
pub mod mode;
pub mod tool;
pub mod transport;

use std::fmt;

use bluetooth_serial_port::BtAddr;

pub use mode::{Brightness, LightMode};
pub use tool::ToolInfo;
use transport::{BtTransport, Transport};

/// Command bytes that are not part of a mode or tool.
pub const CMD_BRIGHTNESS: u8 = 0x74;

#[derive(Debug)]
pub enum DeviceError {
    Connect(String),
    Io(std::io::Error),
}

impl fmt::Display for DeviceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Connect(e) => write!(f, "connection failed: {e}"),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for DeviceError {}

impl From<std::io::Error> for DeviceError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

/// A connected display. The link is closed on [`Pixoo::disconnect`] or drop.
pub struct Pixoo<T: Transport = BtTransport> {
    transport: T,
}

impl Pixoo<BtTransport> {
    pub fn connect(addr: BtAddr) -> Result<Self, DeviceError> {
        Ok(Self::with_transport(BtTransport::connect(addr)?))
    }
}

impl<T: Transport> Pixoo<T> {
    pub fn with_transport(transport: T) -> Self {
        Self { transport }
    }

    pub fn is_connected(&self) -> bool {
        self.transport.is_open()
    }

    /// Close the link now. Safe to call more than once; later sends fail with
    /// "not connected".
    pub fn disconnect(&mut self) {
        self.transport.close();
    }

    pub fn send(&mut self, cmd: u8, args: &[u8]) -> Result<(), DeviceError> {
        let packet = frame::encode(cmd, args);
        tracing::trace!(hex = %hex::encode(&packet), "device tx");
        self.transport.send(&packet)?;
        Ok(())
    }

    pub fn set_brightness(&mut self, brightness: Brightness) -> Result<(), DeviceError> {
        self.send(CMD_BRIGHTNESS, &[brightness.percent()])
    }

    /// Push a full-screen 16x16 image (other sizes are resized). Needs device
    /// test; see [`image`].
    pub fn set_image(&mut self, img: &::image::DynamicImage) -> Result<(), DeviceError> {
        self.send(image::CMD_IMAGE, &image::encode(img))
    }

    pub fn set_mode(&mut self, mode: LightMode) -> Result<(), DeviceError> {
        self.send(mode::CMD_MODE, &mode.encode())
    }

    pub fn set_tool_info(&mut self, tool: ToolInfo) -> Result<(), DeviceError> {
        let (cmd, args) = tool.encode();
        self.send(cmd, &args)
    }
}

impl<T: Transport> Drop for Pixoo<T> {
    fn drop(&mut self) {
        self.transport.close();
    }
}

#[cfg(test)]
mod tests {
    use super::mode::*;
    use super::tool::*;
    use super::transport::mock::MockTransport;
    use super::*;

    fn sent(f: impl FnOnce(&mut Pixoo<MockTransport>)) -> Vec<Vec<u8>> {
        let (t, log) = MockTransport::new();
        let mut p = Pixoo::with_transport(t);
        f(&mut p);
        drop(p);
        let packets = log.lock().unwrap().packets.clone();
        packets
    }

    fn one(f: impl FnOnce(&mut Pixoo<MockTransport>)) -> Vec<u8> {
        let mut v = sent(f);
        assert_eq!(v.len(), 1, "expected exactly one packet");
        v.remove(0)
    }

    // Golden packets were computed by hand from the layout in each module's
    // docs: len = args + 3, checksum = sum(len..args), both little-endian.

    #[test]
    fn brightness() {
        let b = |pct| one(|p| p.set_brightness(Brightness::new(pct).unwrap()).unwrap());
        assert_eq!(b(50), [0x01, 0x04, 0x00, 0x74, 0x32, 0xAA, 0x00, 0x02]);
        assert_eq!(b(100), [0x01, 0x04, 0x00, 0x74, 0x64, 0xDC, 0x00, 0x02]);
    }

    #[test]
    fn brightness_range() {
        assert!(Brightness::new(101).is_none());
        assert_eq!(Brightness::from_percent(255).percent(), 100);
    }

    #[test]
    fn clock_mode() {
        let pkt = one(|p| {
            p.set_mode(LightMode::Env {
                clock_design: ClockDesign::Digital,
                show_divoom: true,
                show_weather: true,
                show_temp: true,
                show_date: true,
                color: [255, 0, 0],
            })
            .unwrap()
        });
        assert_eq!(
            pkt,
            [
                0x01, 0x0D, 0x00, 0x45, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x01, 0xFF, 0x00, 0x00,
                0x56, 0x01, 0x02
            ]
        );
    }

    #[test]
    fn clock_designs_use_documented_indexes() {
        use ClockDesign::*;
        let idx = [
            Digital,
            DigitalRainbow,
            DigitalBox,
            Analog1,
            DigitalInverted,
            Analog2,
        ];
        for (i, d) in idx.into_iter().enumerate() {
            assert_eq!(d as u8, i as u8);
        }
    }

    #[test]
    fn light_mode() {
        let pkt = one(|p| {
            p.set_mode(LightMode::Light {
                color: [255, 120, 0],
                brightness: Brightness::new(50).unwrap(),
                effect_mode: LightEffectMode::Normal,
                on: true,
            })
            .unwrap()
        });
        assert_eq!(
            pkt,
            [
                0x01, 0x0D, 0x00, 0x45, 0x01, 0xFF, 0x78, 0x00, 0x32, 0x00, 0x01, 0x00, 0x00, 0x00,
                0xFD, 0x01, 0x02
            ]
        );
    }

    #[test]
    fn music_mode() {
        let m = |mode| one(|p| p.set_mode(LightMode::Music { mode }).unwrap());
        assert_eq!(
            m(MusicMode::BottomBars),
            [0x01, 0x05, 0x00, 0x45, 0x04, 0x00, 0x4E, 0x00, 0x02]
        );
        assert_eq!(
            m(MusicMode::Fireworks),
            [0x01, 0x05, 0x00, 0x45, 0x04, 0x0A, 0x58, 0x00, 0x02]
        );
        assert_eq!(MusicMode::DancingGirl as u8, 11);
    }

    #[test]
    fn music_modes_match_observed_device_order() {
        use MusicMode::*;
        // Observed on a real Pixoo: index -> mode the display shows.
        let order = [
            BottomBars,
            Face3,
            CenterBars,
            Face1,
            Matrix,
            FrogFace,
            SideBars,
            Face2,
            FallingBlocks,
            DancingBoy,
            Fireworks,
            DancingGirl,
        ];
        for (i, m) in order.into_iter().enumerate() {
            assert_eq!(m as usize, i);
        }
    }

    #[test]
    fn user_mode() {
        let pkt = one(|p| p.set_mode(LightMode::User).unwrap());
        assert_eq!(pkt, [0x01, 0x05, 0x00, 0x45, 0x05, 0x00, 0x4F, 0x00, 0x02]);
    }

    #[test]
    fn score_mode() {
        let pkt = one(|p| {
            p.set_mode(LightMode::Score {
                red_score: 12,
                blue_score: 34,
            })
            .unwrap()
        });
        assert_eq!(
            pkt,
            [0x01, 0x09, 0x00, 0x45, 0x06, 0x00, 0x0C, 0x00, 0x22, 0x00, 0x82, 0x00, 0x02]
        );
    }

    #[test]
    fn score_mode_supports_999_and_clamps() {
        let s = |r, b| {
            one(|p| {
                p.set_mode(LightMode::Score {
                    red_score: r,
                    blue_score: b,
                })
                .unwrap()
            })
        };
        // 999 = 0x03E7, little-endian E7 03
        let p = s(999, 999);
        assert_eq!(&p[5..10], [0x00, 0xE7, 0x03, 0xE7, 0x03]);
        assert_eq!(s(5000, 5000), p);
    }

    #[test]
    fn score_tool_clamps_to_999() {
        let pkt = one(|p| {
            p.set_tool_info(ToolInfo::Score {
                on: true,
                red_score: 1000,
                blue_score: 999,
            })
            .unwrap()
        });
        assert_eq!(&pkt[5..9], [0xE7, 0x03, 0xE7, 0x03]);
    }

    #[test]
    fn countdown_tool() {
        let c = |control, minutes, secs| {
            one(|p| {
                p.set_tool_info(ToolInfo::CountDown {
                    control,
                    minutes,
                    seconds: Seconds::new(secs).unwrap(),
                })
                .unwrap()
            })
        };
        assert_eq!(
            c(CountDownControl::Start, 5, 0),
            [0x01, 0x07, 0x00, 0x72, 0x03, 0x01, 0x05, 0x00, 0x82, 0x00, 0x02]
        );
        assert_eq!(
            c(CountDownControl::Cancel, 0, 0),
            [0x01, 0x07, 0x00, 0x72, 0x03, 0x00, 0x00, 0x00, 0x7C, 0x00, 0x02]
        );
    }

    #[test]
    fn seconds_range() {
        assert!(Seconds::new(59).is_some());
        assert!(Seconds::new(60).is_none());
    }

    #[test]
    fn noise_tool() {
        let n = |c| one(|p| p.set_tool_info(ToolInfo::Noise(c)).unwrap());
        assert_eq!(
            n(NoiseControl::Start),
            [0x01, 0x05, 0x00, 0x72, 0x02, 0x01, 0x7A, 0x00, 0x02]
        );
        assert_eq!(
            n(NoiseControl::Stop),
            [0x01, 0x05, 0x00, 0x72, 0x02, 0x00, 0x79, 0x00, 0x02]
        );
    }

    #[test]
    fn timer_tool() {
        let t = |c| one(|p| p.set_tool_info(ToolInfo::Timer(c)).unwrap());
        assert_eq!(
            t(TimerControl::Start),
            [0x01, 0x05, 0x00, 0x72, 0x00, 0x01, 0x78, 0x00, 0x02]
        );
        assert_eq!(
            t(TimerControl::Stop),
            [0x01, 0x05, 0x00, 0x72, 0x00, 0x00, 0x77, 0x00, 0x02]
        );
    }

    #[test]
    fn score_tool() {
        let pkt = one(|p| {
            p.set_tool_info(ToolInfo::Score {
                on: true,
                red_score: 12,
                blue_score: 300,
            })
            .unwrap()
        });
        assert_eq!(
            pkt,
            [0x01, 0x08, 0x00, 0x50, 0x01, 0x0C, 0x00, 0x2C, 0x01, 0x92, 0x00, 0x02]
        );
    }

    #[test]
    fn drop_closes_the_link() {
        let (t, log) = MockTransport::new();
        let p = Pixoo::with_transport(t);
        assert_eq!(log.lock().unwrap().closes, 0);
        drop(p);
        assert_eq!(log.lock().unwrap().closes, 1);
    }

    #[test]
    fn disconnect_is_explicit_and_idempotent() {
        let (t, log) = MockTransport::new();
        let mut p = Pixoo::with_transport(t);
        assert!(p.is_connected());
        p.disconnect();
        p.disconnect();
        assert!(!p.is_connected());
        assert_eq!(log.lock().unwrap().closes, 1);
        drop(p);
        assert_eq!(log.lock().unwrap().closes, 1);
    }

    #[test]
    fn send_after_disconnect_reports_not_connected() {
        let (t, _log) = MockTransport::new();
        let mut p = Pixoo::with_transport(t);
        p.disconnect();
        let e = p.set_brightness(Brightness::from_percent(10)).unwrap_err();
        assert!(e.to_string().contains("not connected"));
    }
}
