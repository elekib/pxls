use bluetooth_serial_port::BtAddr;
// The driver is pxls's own `device` module, included directly because the
// backend is a binary crate.
#[allow(dead_code)]
#[path = "../src/device/mod.rs"]
mod device;

use device::tool::{CountDownControl, NoiseControl, Seconds, TimerControl};
use device::{Brightness, Pixoo, ToolInfo};
use std::io::{self, Write};
use std::str::FromStr;
use std::thread;
use std::time::Duration;

// Exercises the tool commands of the in-repo device module against a real display.
// Every command here is marked "needs device test" in docs/protocol.md.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("╔══════════════════════════════════════════════════════════════╗");
    println!("║    pxls device module tool tester                           ║");
    println!("║    Tests set_tool_info() with the device module             ║");
    println!("╚══════════════════════════════════════════════════════════════╝");
    println!();

    let mac = prompt("Enter Pixoo MAC address: ");
    let bt_addr = match BtAddr::from_str(&mac) {
        Ok(addr) => addr,
        Err(_) => {
            eprintln!("Invalid MAC address format. Use XX:XX:XX:XX:XX:XX");
            std::process::exit(1);
        }
    };

    println!("\nConnecting to {mac}...");
    let mut pixoo = Pixoo::connect(bt_addr)?;
    println!("✓ Connected!");

    // Set reasonable brightness for visibility
    pixoo.set_brightness(Brightness::new(30).unwrap())?;
    println!("✓ Brightness set to 30%");

    loop {
        print_menu();
        let choice = prompt("\nSelect test: ");

        match choice.trim() {
            "1" => test_noise_meter(&mut pixoo)?,
            "2" => test_timer(&mut pixoo)?,
            "3" => test_scoreboard(&mut pixoo)?,
            "4" => test_countdown(&mut pixoo)?,
            "5" => test_brightness_toggle(&mut pixoo)?,
            "0" => {
                println!("\nDisconnecting...");
                pixoo.disconnect();
                println!("Done!");
                break;
            }
            _ => println!("Invalid option"),
        }
    }

    Ok(())
}

fn print_menu() {
    println!("\n┌─────────────────────────────────────────────────────────────┐");
    println!("│  DEVICE MODULE TESTS (uses set_tool_info)                   │");
    println!("├─────────────────────────────────────────────────────────────┤");
    println!("│  1. Noise Meter (Start/Stop)                                 │");
    println!("│  2. Timer (Start/Stop)                                         │");
    println!("│  3. Scoreboard (interactive scoring)                        │");
    println!("│  4. Countdown (configurable)                                 │");
    println!("│  5. Brightness Toggle (test basic function)                 │");
    println!("│  0. Exit                                                    │");
    println!("└─────────────────────────────────────────────────────────────┘");
}

fn test_noise_meter(pixoo: &mut Pixoo) -> Result<(), Box<dyn std::error::Error>> {
    println!("\n--- Testing Noise Meter ---");

    println!("Starting noise meter for 5 seconds...");
    pixoo.set_tool_info(ToolInfo::Noise(NoiseControl::Start))?;
    println!("✓ Noise(Start) sent");

    thread::sleep(Duration::from_secs(5));

    println!("Stopping noise meter...");
    pixoo.set_tool_info(ToolInfo::Noise(NoiseControl::Stop))?;
    println!("✓ Noise(Stop) sent");

    println!("\nNoise test complete. Did the device show noise levels?");
    Ok(())
}

fn test_timer(pixoo: &mut Pixoo) -> Result<(), Box<dyn std::error::Error>> {
    println!("\n--- Testing Timer ---");

    println!("Starting timer for 3 seconds...");
    pixoo.set_tool_info(ToolInfo::Timer(TimerControl::Start))?;
    println!("✓ Timer(Start) sent");

    thread::sleep(Duration::from_secs(3));

    println!("Stopping timer...");
    pixoo.set_tool_info(ToolInfo::Timer(TimerControl::Stop))?;
    println!("✓ Timer(Stop) sent");

    println!("\nTimer test complete.");
    Ok(())
}

fn test_scoreboard(pixoo: &mut Pixoo) -> Result<(), Box<dyn std::error::Error>> {
    println!("\n--- Testing Scoreboard ---");
    println!("This will cycle through some scores...");

    let tests = vec![
        (10, 20, "Initial scores"),
        (50, 20, "Red increases"),
        (50, 50, "Tie game"),
        (99, 50, "Red leads"),
        (99, 100, "Blue takes lead"),
    ];

    for (red, blue, desc) in tests {
        println!("  {desc}: {red}-{blue}...");
        pixoo.set_tool_info(ToolInfo::Score {
            on: true,
            red_score: red,
            blue_score: blue,
        })?;
        thread::sleep(Duration::from_secs(2));
    }

    println!("Turning off scoreboard...");
    pixoo.set_tool_info(ToolInfo::Score {
        on: false,
        red_score: 0,
        blue_score: 0,
    })?;

    println!("\nScoreboard test complete.");
    Ok(())
}

fn test_countdown(pixoo: &mut Pixoo) -> Result<(), Box<dyn std::error::Error>> {
    println!("\n--- Testing Countdown ---");

    let mins = prompt("Minutes [0]: ").trim().parse::<u8>().unwrap_or(0);
    let secs = prompt("Seconds [10]: ").trim().parse::<u8>().unwrap_or(10);

    // Validate seconds (0-59)
    let seconds = match Seconds::new(secs) {
        Some(s) => s,
        None => {
            println!("Invalid seconds value (must be 0-59)");
            return Ok(());
        }
    };

    println!("Starting countdown from {mins}m {secs}s...");
    pixoo.set_tool_info(ToolInfo::CountDown {
        control: CountDownControl::Start,
        minutes: mins,
        seconds,
    })?;
    println!("✓ CountDown(Start, {mins}:{secs}) sent");

    // Let it run for a bit then offer to cancel
    println!("Countdown running... press Enter to cancel early");

    // Simple non-blocking-ish input check would be complex, so just wait
    thread::sleep(Duration::from_secs(3));

    let cancel = prompt("Cancel countdown? (y/n) [n]: ");
    if cancel.trim().to_lowercase() == "y" {
        pixoo.set_tool_info(ToolInfo::CountDown {
            control: CountDownControl::Cancel,
            minutes: 0,
            seconds: Seconds::new(0).unwrap(),
        })?;
        println!("✓ CountDown(Cancel) sent");
    } else {
        println!("Letting countdown finish (or you can wait)...");
    }

    println!("\nCountdown test complete.");
    Ok(())
}

fn test_brightness_toggle(pixoo: &mut Pixoo) -> Result<(), Box<dyn std::error::Error>> {
    println!("\n--- Testing Basic Function ---");
    println!("Toggling brightness to verify connection works...");

    for brightness in [10, 50, 100, 30] {
        println!("  Setting brightness to {brightness}%...");
        pixoo.set_brightness(Brightness::new(brightness).unwrap())?;
        thread::sleep(Duration::from_millis(500));
    }

    println!("✓ Basic function test passed");
    Ok(())
}

fn prompt(text: &str) -> String {
    print!("{text}");
    io::stdout().flush().unwrap();
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    input.trim().to_string()
}
