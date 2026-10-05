use bluetooth_serial_port::{BtAddr, BtProtocol, BtSocket};

// Packet framing comes from the in-repo device module (the backend is a
// binary crate, so the file is included directly).
#[allow(dead_code)]
#[path = "../src/device/mod.rs"]
mod device;

use std::io::{self, Read, Write};
use std::thread;
use std::time::Duration;

// Pixoo Bluetooth Protocol Command Tester
//
// This utility allows you to test various commands through the Bluetooth protocol
// to discover what works on your device.
fn main() {
    println!("╔══════════════════════════════════════════════════════════════╗");
    println!("║      Pixoo Bluetooth Protocol Command Tester v1.0            ║");
    println!("╚══════════════════════════════════════════════════════════════╝");
    println!();

    let mac = prompt_mac_address();
    let bt_addr = match parse_mac(&mac) {
        Some(addr) => addr,
        None => {
            eprintln!("Error: Invalid MAC address format");
            std::process::exit(1);
        }
    };

    println!("\nConnecting to {mac}...");

    loop {
        print_menu();
        let choice = prompt_input("\nSelect option: ");

        match choice.trim() {
            "1" => test_custom_command(&bt_addr),
            "2" => test_predefined_command(&bt_addr),
            "3" => test_buzzer_commands(&bt_addr),
            "4" => test_display_commands(&bt_addr),
            "5" => test_mode_commands(&bt_addr),
            "6" => test_tool_commands(&bt_addr),
            "7" => scan_commands(&bt_addr),
            "8" => raw_send(&bt_addr),
            "9" => probe_modes(&bt_addr),
            "0" => {
                println!("Exiting...");
                break;
            }
            _ => println!("Invalid option, please try again."),
        }
    }
}

fn print_menu() {
    println!("\n┌─────────────────────────────────────────────────────────────┐");
    println!("│                      MAIN MENU                              │");
    println!("├─────────────────────────────────────────────────────────────┤");
    println!("│  1. Send Custom Command      - Enter raw hex/command        │");
    println!("│  2. Predefined Commands      - Common known commands        │");
    println!("│  3. Buzzer Commands          - Test buzzer variations       │");
    println!("│  4. Display Commands         - Test display/brightness      │");
    println!("│  5. Mode Commands            - Test device modes              │");
    println!("│  6. Tool Commands            - Test tools (timer, etc)      │");
    println!("│  7. Command Scan             - Auto-scan command range      │");
    println!("│  8. Raw Send (No Encode)     - Send exact bytes, no framing │");
    println!("│  9. Mode Probe               - Sweep 0x45 channel/value     │");
    println!("│  0. Exit                                                   │");
    println!("└─────────────────────────────────────────────────────────────┘");
}

fn test_custom_command(bt_addr: &BtAddr) {
    println!("\n--- Custom Command Mode ---");
    println!("Enter command in one of these formats:");
    println!("  - Hex string: 01 00 05 31 00 00 37 02");
    println!("  - Or with 0x: 0x01 0x00 0x05 0x31 0x00 0x00 0x37 0x02");
    println!("  - Or continuous: 0100053100003702");

    let input = prompt_input("Hex data (or 'back' to return): ");
    if input.trim().to_lowercase() == "back" {
        return;
    }

    let data = match parse_hex_input(&input) {
        Some(d) => d,
        None => {
            println!("Error: Could not parse hex input");
            return;
        }
    };

    let response_timeout = prompt_input("Response timeout (ms) [1000]: ");
    let timeout_ms = response_timeout.trim().parse::<u64>().unwrap_or(1000);

    send_and_receive(bt_addr, &data, Duration::from_millis(timeout_ms));
}

fn test_predefined_command(bt_addr: &BtAddr) {
    println!("\n--- Predefined Commands ---");

    let commands = [
        ("0x01", "Device Info", "010001010302"),
        ("0x21", "Get Settings", "01000321002502"),
        ("0x24", "Get Temp/Weather", "01000324002802"),
        ("0x44", "Get Brightness", "01000344004802"),
        ("0x61", "Get Animation", "01000361006502"),
        ("0x71", "Get Tool Status", "01000371007502"),
    ];

    for (i, (cmd, name, hex)) in commands.iter().enumerate() {
        println!("  {}. {} ({}) - {}", i + 1, name, cmd, hex);
    }
    println!("  0. Back");

    let choice = prompt_input("\nSelect command: ");
    let choice_num = choice.trim().parse::<usize>().unwrap_or(0);

    if choice_num == 0 || choice_num > commands.len() {
        return;
    }

    let (_, _, hex) = commands[choice_num - 1];
    let data = hex_to_bytes(hex).expect("Invalid hex in predefined");

    send_and_receive(bt_addr, &data, Duration::from_millis(1000));
}

fn test_buzzer_commands(bt_addr: &BtAddr) {
    println!("\n--- Buzzer Command Variations ---");
    println!("Different devices expect different formats. Try these in order:");

    let variations = vec![
        // Format: (name, hex_preview, args, description)
        (
            "1. Minimal (total_time only)",
            "310000",
            vec![0x00, 0x00],
            "Some devices only need total time (2 bytes)",
        ),
        (
            "2. Duration only (BE)",
            "3102BC",
            vec![0x02, 0xBC],
            "700ms beep - big-endian duration only",
        ),
        (
            "3. Standard 4-byte",
            "31006400000095",
            vec![0x00, 0x64, 0x00, 0x00],
            "active=100ms, off=0, typical format",
        ),
        (
            "4. Full 6-byte (BE)",
            "31006400000064",
            vec![0x00, 0x64, 0x00, 0x00, 0x00, 0x64],
            "active=100, off=0, total=100 - big-endian",
        ),
        (
            "5. Full 6-byte (LE total)",
            "31006400006400",
            vec![0x64, 0x00, 0x00, 0x64, 0x00, 0x00],
            "Some firmware uses little-endian",
        ),
        (
            "6. Long beep (500ms)",
            "3101F4000001F4",
            vec![0x01, 0xF4, 0x00, 0x00, 0x01, 0xF4],
            "active=500ms, total=500ms",
        ),
        (
            "7. Double beep",
            "310064006400C8",
            vec![0x00, 0x64, 0x00, 0x64, 0x00, 0xC8],
            "active=100, off=100, total=200",
        ),
        (
            "8. Just command byte",
            "",
            vec![],
            "Bare 0x31 command, no args (rare)",
        ),
    ];

    for (name, hex, _, desc) in &variations {
        println!("  {name} - {hex}");
        println!("      ({desc})");
    }
    println!("  9. Custom buzzer - enter your own args");
    println!("  0. Back");

    let choice = prompt_input("\nSelect variation (1-9 or 0): ");
    let choice_num = choice.trim().parse::<usize>().unwrap_or(0);

    if choice_num == 0 {
        return;
    }

    if choice_num == 9 {
        // Custom entry
        let hex_input = prompt_input("Enter hex args (no 0x prefix): ");
        let args = match parse_hex_input(&hex_input) {
            Some(d) => d,
            None => {
                println!("Error: Could not parse hex");
                return;
            }
        };
        let payload = encode_pixoo_cmd(0x31, &args);
        println!("Sending: {}", bytes_to_hex(&payload));
        send_and_receive(bt_addr, &payload, Duration::from_millis(2000));
        return;
    }

    if choice_num > variations.len() {
        println!("Invalid option");
        return;
    }

    let (_, _, args, _) = &variations[choice_num - 1];
    let payload = encode_pixoo_cmd(0x31, args);

    println!("\nSending: {}", bytes_to_hex(&payload));
    println!("Args breakdown: {args:?}");
    send_and_receive(bt_addr, &payload, Duration::from_millis(2000));
}

fn test_display_commands(bt_addr: &BtAddr) {
    println!("\n--- Display/Brightness Commands ---");

    let brightness = prompt_input("Enter brightness (0-100) [50]: ");
    let brightness_val = brightness.trim().parse::<u8>().unwrap_or(50);
    let brightness_byte = (brightness_val as f32 / 100.0 * 255.0) as u8;

    let commands = vec![
        (
            "Set Brightness (0x74, percent, little-endian framing)",
            encode_pixoo_cmd(0x74, &[brightness_val.min(100)]),
        ),
        (
            "Set Brightness (0x32, legacy guess)",
            encode_pixoo_cmd(0x32, &[brightness_byte]),
        ),
        (
            "Set Brightness BE",
            encode_pixoo_cmd_be(0x32, &[brightness_byte]),
        ),
    ];

    for (name, payload) in &commands {
        println!("\nTesting: {name}");
        println!("Payload: {}", bytes_to_hex(payload));
        send_and_receive(bt_addr, payload, Duration::from_millis(1000));
        thread::sleep(Duration::from_millis(500));
    }
}

fn test_mode_commands(bt_addr: &BtAddr) {
    println!("\n--- Mode Commands ---");

    let modes = [
        ("Clock (0x00)", 0x00u8),
        ("Light (0x01)", 0x01),
        ("Cloud (0x02)", 0x02),
        ("Effects (0x03)", 0x03),
        ("Visualization (0x04)", 0x04),
        ("Custom/user (0x05)", 0x05),
        ("Scoreboard (0x06)", 0x06),
    ];

    for (i, (name, _mode)) in modes.iter().enumerate() {
        println!("  {}. {}", i + 1, name);
    }
    println!("  0. Back");

    let choice = prompt_input("\nSelect mode: ");
    let choice_num = choice.trim().parse::<usize>().unwrap_or(0);

    if choice_num == 0 || choice_num > modes.len() {
        return;
    }

    let (_, mode_val) = modes[choice_num - 1];
    let payload = encode_pixoo_cmd(0x45, &[mode_val, 0x00]);

    send_and_receive(bt_addr, &payload, Duration::from_millis(1000));
}

/// Sweep `45 <channel> <value>` and record what the display shows. Before each
/// probe the display is set to solid red (light mode) so a command that is
/// ignored is obvious: the screen stays red.
fn probe_modes(bt_addr: &BtAddr) {
    println!("\n--- Mode Probe ---");
    let ch = prompt_input("Channel byte (hex) [03]: ");
    let channel = u8::from_str_radix(ch.trim().trim_start_matches("0x"), 16).unwrap_or(0x03);
    let lo = prompt_input("First value [0]: ")
        .trim()
        .parse::<u8>()
        .unwrap_or(0);
    let hi = prompt_input("Last value [15]: ")
        .trim()
        .parse::<u8>()
        .unwrap_or(15);
    let with_value = prompt_input("Send a value byte? (n = channel only) [y]: ");
    let with_value = with_value.trim().to_lowercase() != "n";

    let red = encode_pixoo_cmd(
        0x45,
        &[0x01, 0xFF, 0x00, 0x00, 0x32, 0x00, 0x01, 0x00, 0x00, 0x00],
    );
    let mut log: Vec<(u8, String)> = Vec::new();

    for v in lo..=hi {
        send_and_receive(bt_addr, &red, Duration::from_millis(300));
        thread::sleep(Duration::from_millis(800));

        let args: Vec<u8> = if with_value {
            vec![channel, v]
        } else {
            vec![channel]
        };
        let payload = encode_pixoo_cmd(0x45, &args);
        println!("\n45 {channel:02X} {v:02X}: {}", bytes_to_hex(&payload));
        send_and_receive(bt_addr, &payload, Duration::from_millis(300));

        let seen = prompt_input("What does the display show? (text, 'q' to stop): ");
        if seen.trim() == "q" {
            break;
        }
        log.push((v, seen.trim().to_string()));
        if !with_value {
            break;
        }
    }

    println!("\n--- Results for channel 0x{channel:02X} ---");
    for (v, seen) in log {
        println!("  value {v:>3} (0x{v:02X}): {seen}");
    }
}

fn test_tool_commands(bt_addr: &BtAddr) {
    println!("\n--- Tool Commands ---");

    println!("  1. Start Countdown");
    println!("  2. Stop Countdown");
    println!("  3. Start Stopwatch");
    println!("  4. Stop Stopwatch");
    println!("  5. Start Noise Meter");
    println!("  6. Stop Noise Meter");
    println!("  0. Back");

    let choice = prompt_input("\nSelect tool: ");

    let args: Vec<u8> = match choice.trim() {
        "1" => {
            let min = prompt_input("Minutes [1]: ")
                .trim()
                .parse::<u8>()
                .unwrap_or(1);
            let sec = prompt_input("Seconds [0]: ")
                .trim()
                .parse::<u8>()
                .unwrap_or(0);
            vec![0x03, 0x01, min, sec]
        }
        "2" => vec![0x03, 0x00, 0x00, 0x00],
        "3" => vec![0x00, 0x01, 0x00, 0x00],
        "4" => vec![0x00, 0x00, 0x00, 0x00],
        "5" => vec![0x02, 0x01],
        "6" => vec![0x02, 0x00, 0x00, 0x00],
        _ => return,
    };

    let payload = encode_pixoo_cmd(0x72, &args);
    send_and_receive(bt_addr, &payload, Duration::from_millis(1000));
}

fn scan_commands(bt_addr: &BtAddr) {
    println!("\n--- Command Scan Mode ---");
    println!("WARNING: This will send many commands to your device.");
    println!("Only run this if you understand the risks.");

    let confirm = prompt_input("Type 'yes' to continue: ");
    if confirm.trim() != "yes" {
        println!("Scan cancelled.");
        return;
    }

    let start = prompt_input("Start command (hex) [0x01]: ");
    let start_cmd = u8::from_str_radix(start.trim().trim_start_matches("0x"), 16).unwrap_or(0x01);

    let end = prompt_input("End command (hex) [0xFF]: ");
    let end_cmd = u8::from_str_radix(end.trim().trim_start_matches("0x"), 16).unwrap_or(0xFF);

    let delay = prompt_input("Delay between commands (ms) [500]: ");
    let delay_ms = delay.trim().parse::<u64>().unwrap_or(500);

    println!("\nScanning commands 0x{start_cmd:02X} to 0x{end_cmd:02X}...");

    for cmd in start_cmd..=end_cmd {
        let payload = encode_pixoo_cmd(cmd, &[]);
        print!("Testing 0x{cmd:02X}: ");
        io::stdout().flush().unwrap();

        match try_send(bt_addr, &payload, Duration::from_millis(500)) {
            Ok(Some(response)) => {
                println!("RESPONSE: {}", bytes_to_hex(&response));
            }
            Ok(None) => {
                println!("OK (no response)");
            }
            Err(e) => {
                println!("ERROR: {e}");
            }
        }

        thread::sleep(Duration::from_millis(delay_ms));
    }

    println!("\nScan complete!");
}

fn raw_send(bt_addr: &BtAddr) {
    println!("\n--- Raw Send Mode (NO automatic framing) ---");
    println!("This sends EXACT bytes without adding headers/checksums.");
    println!("Use this to test specific packet formats:");
    println!("  - Different start bytes (not 0x01)");
    println!("  - Different end bytes (not 0x02)");
    println!("  - Different checksum algorithms");
    println!("  - Copy exact packets from packet captures");
    println!();
    println!("Example buzzer packets to try:");
    println!("  01 00 04 31 00 64 00 9A 02  - Standard 4-arg");
    println!("  01 00 06 31 00 64 00 00 64 C6 02  - Full 6-arg");
    println!("  01 00 08 31 01 F4 00 00 03 E8 05 C5 02  - Long beep");

    let input = prompt_input("\nEnter full hex packet (or 'back'): ");
    if input.trim().to_lowercase() == "back" {
        return;
    }

    let data = match parse_hex_input(&input) {
        Some(d) => d,
        None => {
            println!("Error: Could not parse hex input");
            return;
        }
    };

    println!("Sending {} raw bytes: {}", data.len(), bytes_to_hex(&data));
    println!("(No encoding applied - sending exactly what you entered)");

    let response_timeout = prompt_input("Response timeout (ms) [1000]: ");
    let timeout_ms = response_timeout.trim().parse::<u64>().unwrap_or(1000);

    send_and_receive(bt_addr, &data, Duration::from_millis(timeout_ms));
}

/// Encode a command with pxls's framing (little-endian length and checksum).
fn encode_pixoo_cmd(cmd: u8, args: &[u8]) -> Vec<u8> {
    device::frame::encode(cmd, args)
}

/// Same packet with both 16-bit fields big-endian, the layout older notes in
/// docs/protocol.md describe. Useful to check which one your device accepts.
fn encode_pixoo_cmd_be(cmd: u8, args: &[u8]) -> Vec<u8> {
    let payload_size = args.len() + 3;
    let mut buf = vec![1, (payload_size >> 8) as u8, payload_size as u8, cmd];
    buf.extend_from_slice(args);
    let checksum = buf[1..].iter().map(|n| *n as u16).sum::<u16>();
    buf.push((checksum >> 8) as u8);
    buf.push(checksum as u8);
    buf.push(2);
    buf
}

fn send_and_receive(bt_addr: &BtAddr, data: &[u8], timeout: Duration) {
    match try_send(bt_addr, data, timeout) {
        Ok(Some(response)) => {
            println!("✓ Sent successfully");
            println!(
                "  Response ({} bytes): {}",
                response.len(),
                bytes_to_hex(&response)
            );
        }
        Ok(None) => {
            println!("✓ Sent successfully (no response within timeout)");
        }
        Err(e) => {
            println!("✗ Error: {e}");
        }
    }
}

fn try_send(
    bt_addr: &BtAddr,
    data: &[u8],
    _timeout: Duration,
) -> Result<Option<Vec<u8>>, Box<dyn std::error::Error>> {
    let mut socket = BtSocket::new(BtProtocol::RFCOMM)?;
    socket.connect(*bt_addr)?;
    socket.write_all(data)?;
    socket.flush()?;

    // Note: BtSocket doesn't support set_read_timeout
    // Just try a non-blocking read immediately after sending
    let mut buf = vec![0u8; 256];
    match socket.read(&mut buf) {
        Ok(n) if n > 0 => {
            buf.truncate(n);
            Ok(Some(buf))
        }
        Ok(_) => Ok(None),
        Err(_) => Ok(None), // No response available
    }
}

fn prompt_mac_address() -> String {
    println!("Enter the MAC address of your Pixoo device");
    println!("  Format: XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX");
    prompt_input("MAC: ")
}

fn parse_mac(mac: &str) -> Option<BtAddr> {
    let cleaned: String = mac.chars().filter(|c| c.is_alphanumeric()).collect();
    if cleaned.len() != 12 {
        return None;
    }

    let bytes = hex::decode(&cleaned).ok()?;
    let addr: [u8; 6] = bytes.try_into().ok()?;
    Some(BtAddr(addr))
}

fn prompt_input(prompt: &str) -> String {
    print!("{prompt}");
    io::stdout().flush().unwrap();
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    input.trim().to_string()
}

fn parse_hex_input(input: &str) -> Option<Vec<u8>> {
    let cleaned = input.replace("0x", "").replace(" ", "").replace("-", "");
    hex::decode(&cleaned).ok()
}

fn hex_to_bytes(hex: &str) -> Option<Vec<u8>> {
    hex::decode(hex).ok()
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}
