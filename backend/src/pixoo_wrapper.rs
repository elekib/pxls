use bluetooth_serial_port::BtAddr;

use crate::device::tool::{CountDownControl, NoiseControl, Seconds};
use crate::device::{Pixoo, ToolInfo};

pub struct PixooWrapper {
    pixoo: Option<Pixoo>,
    bt_addr: Option<BtAddr>,
}

impl Default for PixooWrapper {
    fn default() -> Self {
        Self::new()
    }
}

impl PixooWrapper {
    pub fn new() -> Self {
        Self {
            pixoo: None,
            bt_addr: None,
        }
    }

    pub fn with_pixoo(pixoo: Pixoo, bt_addr: BtAddr) -> Self {
        Self {
            pixoo: Some(pixoo),
            bt_addr: Some(bt_addr),
        }
    }

    pub fn empty() -> Self {
        Self {
            pixoo: None,
            bt_addr: None,
        }
    }

    pub fn set_bt_addr(&mut self, addr: BtAddr) {
        self.bt_addr = Some(addr);
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

    /// Play the buzzer for `total_time` ms. `active_time` and `off_time` are
    /// accepted for API compatibility; the only buzzer layout we send carries
    /// the total time (needs device test, see docs/protocol.md).
    pub fn play_buzzer(
        &mut self,
        _active_time: u16,
        _off_time: u16,
        total_time: u16,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let bt_addr = self.bt_addr.ok_or("No Bluetooth address available")?;

        let mut pixoo = Pixoo::connect(bt_addr)?;
        tracing::info!(total_time, "Sending buzzer command 0x31");
        pixoo.play_buzzer(total_time)?;

        // Wait for sound to play, then close the link (also closed on drop).
        std::thread::sleep(std::time::Duration::from_millis(total_time as u64 + 500));
        pixoo.disconnect();
        tracing::info!("Buzzer command complete");

        Ok(())
    }

    /// Start countdown timer using library API
    pub fn start_countdown(
        &mut self,
        minutes: u8,
        seconds: u8,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let bt_addr = self.bt_addr.ok_or("No Bluetooth address available")?;

        // Clear current connection so rendering loop stops
        self.pixoo = None;
        std::thread::sleep(std::time::Duration::from_millis(500));

        tracing::info!(
            "Starting countdown {}m {}s via library API",
            minutes,
            seconds
        );

        // Connect with timeout
        tracing::info!("Connecting to Pixoo...");
        let mut pixoo = Pixoo::connect(bt_addr)?;
        tracing::info!("Connected successfully");

        // Create Seconds type for seconds parameter
        let seconds_val = Seconds::new(seconds)
            .ok_or_else(|| format!("Invalid seconds value: {seconds} (must be 0-59)"))?;

        tracing::info!(
            "Calling set_tool_info with CountDown {{ control: Start, minutes: {}, seconds: {} }}",
            minutes,
            seconds
        );

        pixoo.set_tool_info(ToolInfo::CountDown {
            control: CountDownControl::Start,
            minutes,
            seconds: seconds_val,
        })?;

        tracing::info!("Countdown command sent successfully");

        // Disconnect and let countdown run on device
        pixoo.disconnect();
        tracing::info!("Disconnected, countdown should be running on device");

        Ok(())
    }

    /// Start sound detector (noise meter)
    pub fn start_sound_detector(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let bt_addr = self.bt_addr.ok_or("No Bluetooth address available")?;

        // Clear current connection so rendering loop stops
        self.pixoo = None;
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Use the library's proper API for tools
        tracing::info!("Connecting to start sound detector...");
        let mut pixoo = Pixoo::connect(bt_addr)?;

        tracing::info!("Starting noise meter via set_tool_info");
        pixoo.set_tool_info(ToolInfo::Noise(NoiseControl::Start))?;

        // Disconnect and leave tool running
        pixoo.disconnect();
        tracing::info!(
            "Sound detector command sent, leaving pixoo disconnected for reconnection loop"
        );

        Ok(())
    }

    /// Set scoreboard display using the tool API (command 0x50)
    ///
    /// The scoreboard tool is distinct from the scoreboard *mode* (LightMode::Score,
    /// command 0x45 mode 6). The tool version is what the Divoom app uses: it has an
    /// `on` flag and 16-bit scores, and the device runs it independently once started
    /// — no need to hold the Bluetooth connection open. Using LightMode::Score here
    /// previously caused garbage/random numbers on screen because the rendering
    /// loop's reconnect would race this connection and override the display.
    pub fn set_scoreboard(
        &mut self,
        red_score: u8,
        blue_score: u8,
    ) -> Result<(), Box<dyn std::error::Error>> {
        tracing::info!(
            "Setting scoreboard via tool API: Red={}, Blue={}",
            red_score,
            blue_score
        );

        let bt_addr = self.bt_addr.ok_or("No Bluetooth address available")?;

        // Clear current connection so rendering loop stops interfering
        self.pixoo = None;
        std::thread::sleep(std::time::Duration::from_millis(500));

        tracing::info!("Connecting to Pixoo...");
        let mut pixoo = Pixoo::connect(bt_addr)?;
        tracing::info!("Connected, sending scoreboard tool command");

        // Use the tool API (0x50) with on=true so the device runs the scoreboard
        // tool independently. Scores are u8 (0-99) promoted to u16 as the tool API
        // expects.
        pixoo.set_tool_info(ToolInfo::Score {
            on: true,
            red_score: red_score as u16,
            blue_score: blue_score as u16,
        })?;

        tracing::info!(
            "Scoreboard tool command sent: Red={}, Blue={}",
            red_score,
            blue_score
        );

        // Drop the connection — the scoreboard tool runs on the device itself,
        // same as countdown and sound detector. The rendering loop will reconnect
        // but skip rendering while tool_active_until is set.
        pixoo.disconnect();
        tracing::info!("Disconnected, scoreboard should be running on device");

        Ok(())
    }

    /// Stop scoreboard and release connection
    pub fn stop_scoreboard(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        tracing::info!("Stopping scoreboard and releasing connection");
        self.pixoo = None;
        std::thread::sleep(std::time::Duration::from_millis(500));
        tracing::info!("Scoreboard stopped, connection released");
        Ok(())
    }
}
