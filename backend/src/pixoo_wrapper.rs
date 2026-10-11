use anyhow::{anyhow, Result};

use crate::config::DeviceConfig;
use crate::device::tool::{CountDownControl, NoiseControl, Seconds};
use crate::device::transport::Transport;
use crate::device::{DeviceError, LightMode, Pixoo, ToolInfo};
use crate::rendering::device_config::apply_device_config;
use crate::tool_state::ToolKind;

/// What to do with the Bluetooth link after a tool command is sent.
///
/// `KeepOpen` is the default: the device is driven the same way as from the
/// Device config page, on the already-open link. `Close` is the fallback if a
/// device needs the link released for a tool to keep running; select it with
/// `PXLS_TOOL_CLOSE_LINK=1` (the render loop then reconnects when the tool ends).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolLink {
    KeepOpen,
    Close,
}

impl ToolLink {
    pub fn from_env() -> Self {
        match std::env::var("PXLS_TOOL_CLOSE_LINK").as_deref() {
            Ok("1") | Ok("true") => Self::Close,
            _ => Self::KeepOpen,
        }
    }
}

/// Start a countdown. Needs device test.
pub fn start_countdown<T: Transport>(
    pixoo: &mut Pixoo<T>,
    minutes: u8,
    seconds: u8,
    link: ToolLink,
) -> Result<()> {
    let seconds =
        Seconds::new(seconds).ok_or_else(|| anyhow!("Invalid seconds value: {seconds} (0-59)"))?;
    pixoo.set_tool_info(ToolInfo::CountDown {
        control: CountDownControl::Start,
        minutes,
        seconds,
    })?;
    release(pixoo, link);
    Ok(())
}

/// Start the noise meter. Needs device test.
pub fn start_sound_detector<T: Transport>(pixoo: &mut Pixoo<T>, link: ToolLink) -> Result<()> {
    pixoo.set_tool_info(ToolInfo::Noise(NoiseControl::Start))?;
    release(pixoo, link);
    Ok(())
}

/// Update the scoreboard with one mode packet (`0x45 06`, the same command the
/// Device config page uses). The link stays open. Needs device test.
pub fn set_score<T: Transport>(
    pixoo: &mut Pixoo<T>,
    red_score: u16,
    blue_score: u16,
) -> Result<()> {
    pixoo.set_mode(LightMode::Score {
        red_score,
        blue_score,
    })?;
    Ok(())
}

/// Return the display to the configured mode after a tool ended. `user_stop`
/// also sends the tool's own stop command first; a timer that ran out needs
/// no stop. Needs device test.
pub fn end_tool<T: Transport>(
    pixoo: &mut Pixoo<T>,
    kind: ToolKind,
    user_stop: bool,
    device_config: &DeviceConfig,
) -> Result<()> {
    if user_stop {
        match kind {
            ToolKind::Countdown => pixoo.set_tool_info(ToolInfo::CountDown {
                control: CountDownControl::Cancel,
                minutes: 0,
                seconds: Seconds::new(0).expect("0 is a valid second"),
            })?,
            ToolKind::SoundDetector => pixoo.set_tool_info(ToolInfo::Noise(NoiseControl::Stop))?,
            ToolKind::Scoreboard | ToolKind::Diagnostics => {}
        }
    }
    apply_device_config(pixoo, device_config).map_err(|e| anyhow!("{e}"))
}

fn release<T: Transport>(pixoo: &mut Pixoo<T>, link: ToolLink) {
    if link == ToolLink::Close {
        pixoo.disconnect();
    }
}

pub struct PixooWrapper {
    pixoo: Option<Pixoo>,
}

impl Default for PixooWrapper {
    fn default() -> Self {
        Self::new()
    }
}

impl PixooWrapper {
    pub fn new() -> Self {
        Self { pixoo: None }
    }

    pub fn get(&self) -> Option<&Pixoo> {
        self.pixoo.as_ref()
    }

    pub fn get_mut(&mut self) -> Option<&mut Pixoo> {
        self.pixoo.as_mut()
    }

    pub fn replace(&mut self, new_pixoo: Pixoo) {
        self.pixoo = Some(new_pixoo);
    }

    /// Run `f` on the open link. A device error or a closed link drops it so
    /// the render loop reconnects. Nothing here sleeps; callers hold the lock
    /// only for the packet writes.
    pub fn with_link<R>(&mut self, f: impl FnOnce(&mut Pixoo) -> Result<R>) -> Result<R> {
        let pixoo = self
            .pixoo
            .as_mut()
            .ok_or_else(|| anyhow!("Not connected to a device"))?;
        let result = f(pixoo);
        let dead = !pixoo.is_connected()
            || result
                .as_ref()
                .err()
                .is_some_and(|e| e.downcast_ref::<DeviceError>().is_some());
        if dead {
            self.pixoo = None;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::frame;
    use crate::device::transport::mock::MockTransport;

    fn packet(cmd: u8, args: &[u8]) -> Vec<u8> {
        frame::encode(cmd, args)
    }

    fn pixoo() -> (
        Pixoo<MockTransport>,
        std::sync::Arc<std::sync::Mutex<crate::device::transport::mock::Log>>,
    ) {
        let (t, log) = MockTransport::new();
        (Pixoo::with_transport(t), log)
    }

    #[test]
    fn countdown_sends_one_packet_and_keeps_link_open() {
        let (mut p, log) = pixoo();
        start_countdown(&mut p, 5, 30, ToolLink::KeepOpen).unwrap();
        let log = log.lock().unwrap();
        assert_eq!(log.packets, vec![packet(0x72, &[0x03, 1, 5, 30])]);
        assert_eq!(log.closes, 0);
        assert!(p.is_connected());
    }

    #[test]
    fn countdown_rejects_bad_seconds_without_sending() {
        let (mut p, log) = pixoo();
        assert!(start_countdown(&mut p, 1, 60, ToolLink::KeepOpen).is_err());
        assert!(log.lock().unwrap().packets.is_empty());
    }

    #[test]
    fn sound_detector_sends_one_packet_and_keeps_link_open() {
        let (mut p, log) = pixoo();
        start_sound_detector(&mut p, ToolLink::KeepOpen).unwrap();
        let log = log.lock().unwrap();
        assert_eq!(log.packets, vec![packet(0x72, &[0x02, 1])]);
        assert_eq!(log.closes, 0);
    }

    #[test]
    fn fallback_link_mode_closes_after_sending() {
        let (mut p, log) = pixoo();
        start_sound_detector(&mut p, ToolLink::Close).unwrap();
        assert_eq!(log.lock().unwrap().packets.len(), 1);
        assert_eq!(log.lock().unwrap().closes, 1);
        assert!(!p.is_connected());
    }

    #[test]
    fn score_update_is_exactly_one_mode_packet() {
        let (mut p, log) = pixoo();
        set_score(&mut p, 12, 345).unwrap();
        let log = log.lock().unwrap();
        // 45 06 00 red(le16) blue(le16), not the 0x50 tool command.
        assert_eq!(
            log.packets,
            vec![packet(0x45, &[0x06, 0x00, 12, 0, 0x59, 0x01])]
        );
        assert_eq!(log.closes, 0);
    }

    #[test]
    fn ending_a_tool_reapplies_config_on_the_same_link() {
        let (mut p, log) = pixoo();
        let cfg = DeviceConfig::default();
        end_tool(&mut p, ToolKind::Countdown, false, &cfg).unwrap();
        {
            let log = log.lock().unwrap();
            assert!(!log.packets.is_empty());
            // Brightness is always part of apply_device_config.
            assert_eq!(log.packets[0][3], 0x74);
            assert_eq!(log.closes, 0);
        }
        assert!(p.is_connected());
    }

    #[test]
    fn user_stop_sends_the_tool_stop_before_the_config() {
        let (mut p, log) = pixoo();
        end_tool(&mut p, ToolKind::Countdown, true, &DeviceConfig::default()).unwrap();
        let log = log.lock().unwrap();
        assert_eq!(log.packets[0], packet(0x72, &[0x03, 0, 0, 0]));
        assert_eq!(log.packets[1][3], 0x74);
        assert_eq!(log.closes, 0);
    }

    #[test]
    fn timer_expiry_sends_no_stop_packet() {
        let (mut p, log) = pixoo();
        end_tool(
            &mut p,
            ToolKind::SoundDetector,
            false,
            &DeviceConfig::default(),
        )
        .unwrap();
        assert_eq!(log.lock().unwrap().packets[0][3], 0x74);
    }
}
