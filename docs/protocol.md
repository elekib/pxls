# Pixoo Bluetooth Protocol Documentation

This document describes the Bluetooth communication protocol used by Divoom Pixoo devices. Understanding this protocol helps you debug issues, test new features, and extend the functionality of your device.

## Table of Contents

- [Protocol Overview](#protocol-overview)
- [Packet Structure](#packet-structure)
- [Command Reference](#command-reference)
  - [Device Commands (0x01-0x1F)](#device-commands)
  - [Display Commands (0x20-0x3F)](#display-commands)
  - [Mode Commands (0x40-0x5F)](#mode-commands)
  - [Tool Commands (0x70-0x7F)](#tool-commands)
  - [Animation Commands (0x60-0x6F)](#animation-commands)
- [Testing Commands](#testing-commands)
- [Troubleshooting](#troubleshooting)

---

## Protocol Overview

Pixoo devices communicate over Bluetooth RFCOMM (Serial Port Profile). The protocol uses a binary packet format with:

- **Transport**: Bluetooth RFCOMM (virtual serial port)
- **Baud Rate**: Typically 115200 (handled by Bluetooth stack)
- **Packet Format**: Binary with header, payload, and checksum
- **Byte Order**: Big-endian for multi-byte values

---

## Packet Structure

Each packet follows this structure:

```
┌────────┬───────────────┬───────────────┬────────┬───────────┬───────────────┬───────────────┬────────┐
│  Start │ Payload Size  │    Command    │  Args  │   ...     │   Checksum    │     End       │
│  (0x01)│  (2 bytes)    │   (1 byte)    │        │           │   (2 bytes)   │    (0x02)     │
└────────┴───────────────┴───────────────┴────────┴───────────┴───────────────┴───────────────┴────────┘
   1 byte      2 bytes         1 byte      N bytes              2 bytes           1 byte
```

### Field Details

| Field | Size | Description |
|-------|------|-------------|
| Start | 1 byte | Always `0x01` - packet start marker |
| Payload Size | 2 bytes | Size of payload (Command + Args), big-endian |
| Command | 1 byte | Command identifier (see reference below) |
| Arguments | N bytes | Command-specific arguments |
| Checksum | 2 bytes | Sum of all bytes from Payload Size to end of Arguments, big-endian |
| End | 1 byte | Always `0x02` - packet end marker |

### Checksum Calculation

```rust
// Pseudo-code for checksum calculation
let payload_size = args.len() + 3;  // command (1) + args (N) + checksum itself is not included
let packet_without_checksum = [start, size_hi, size_lo, command, ...args];
let checksum = sum_of_all_bytes_in(packet_without_checksum[1..]); // exclude start byte
let checksum_hi = (checksum >> 8) & 0xFF;
let checksum_lo = checksum & 0xFF;
```

### Example Packet

**Set Brightness to 50%:**
```
01 00 04 32 80 00 B6 02
│  │  │  │  │  │  │  │
│  │  │  │  │  │  │  └── End (0x02)
│  │  │  │  │  │  └───── Checksum low (0xB6 = 182)
│  │  │  │  │  └──────── Checksum high (0x00)
│  │  │  │  └─────────── Brightness value (0x80 = 128 = 50%)
│  │  │  └────────────── Command (0x32 = Set Brightness)
│  │  └──────────────── Payload size low (0x04)
│  └───────────────────── Payload size high (0x00)
└──────────────────────── Start (0x01)
```

Checksum calculation: `0x00 + 0x04 + 0x32 + 0x80 = 0xB6` (182)

---

## Command Reference

### Device Commands (0x01-0x1F)

| Command | Code | Arguments | Description |
|---------|------|-----------|-------------|
| Device Info | `0x01` | None | Get device information |
| Get Settings | `0x21` | None | Get device settings |
| Get Temp/Weather | `0x24` | None | Get temperature and weather data |

**Example - Get Device Info:**
```
Request:  01 00 03 01 00 04 02
Response: [device info data]
```

---

### Display Commands (0x20-0x3F)

| Command | Code | Arguments | Description |
|---------|------|-----------|-------------|
| Get Brightness | `0x44` | None | Get current brightness |
| Set Brightness | `0x32` | `brightness: u8` | Set brightness (0-255) |
| Set RGB | `0x46` | `r: u8, g: u8, b: u8` | Set solid color |
| Buzzer | `0x31` | `active: u16, off: u16, total: u16` | Play buzzer |

**Set Brightness Examples:**
```
25%:   01 00 04 32 40 00 76 02  (brightness = 64)
50%:   01 00 04 32 80 00 B6 02  (brightness = 128)
75%:   01 00 04 32 C0 00 F6 02  (brightness = 192)
100%:  01 00 04 32 FF 00 35 03  (brightness = 255)
```

**Buzzer Command:**
```
01 00 08 31 <active_hi> <active_lo> <off_hi> <off_lo> <total_hi> <total_lo> <checksum> 02

Example - 500ms active, 0ms off, 1000ms total:
01 00 08 31 01 F4 00 00 03 E8 05 C5 02
```

**Buzzer Troubleshooting Guide:**

Different Pixoo firmware versions expect different buzzer formats. If the buzzer isn't working, try these formats in order:

| Format | Args | Example Packet | When to Use |
|--------|------|----------------|-------------|
| **Minimal (2-byte)** | `total_time: u16` | `01 00 04 31 00 64 00 99 02` | Try first - some devices only need total time |
| **Standard (4-byte)** | `active, off: u16` | `01 00 06 31 01 F4 00 00 01 FA 02` | active=500ms, off=0 |
| **Full (6-byte)** | `active, off, total: u16` | `01 00 08 31 01 F4 00 00 01 F4 03 EE 02` | Most common spec-compliant format |
| **Little-endian** | Same as above but LE | `01 00 08 31 F4 01 00 00 F4 01 EF 03 02` | Some early firmware uses LE |

**Testing Steps:**
1. First verify device responds to other commands (like Get Brightness 0x44)
2. Try the Minimal format - many newer devices only need total duration
3. If no sound, try Standard 4-byte format
4. Check if device requires User Mode (0x04) active for buzzer
5. Use the `command_tester` utility option 3 for automated testing

**Common Issues:**
- **No sound but ACK received**: Buzzer may be disabled in settings or device is muted
- **No response at all**: Device may not support buzzer or requires different encoding
- **Partial beep**: Arguments may be in wrong byte order (try swapping hi/lo)

**Byte Order Notes:**
- `01 F4` = 500ms (big-endian: 0x01=1, 0xF4=244, 1*256+244=500)
- `F4 01` = 62644ms (little-endian - likely wrong for buzzer)

Use the Raw Send mode (option 8) in the tester to try exact packets without encoding.

---

### Mode Commands (0x40-0x5F)

| Command | Code | Arguments | Description |
|---------|------|-----------|-------------|
| Set Mode | `0x45` | `mode: u8, sub_mode: u8` | Change device mode |

**Mode Values:**
| Mode | Value | Description |
|------|-------|-------------|
| Clock | `0x00` | Clock display with optional date/weather |
| Light | `0x01` | Solid color light |
| Effects | `0x02` | Visual effects |
| Music | `0x03` | Music visualizer |
| User | `0x04` | User-defined image/animation |
| Score | `0x05` | Scoreboard display |

**Example - Set Clock Mode:**
```
01 00 05 45 00 00 00 4B 02
            │  │
            │  └── Sub-mode (clock style)
            └───── Mode: Clock (0x00)
```

**Example - Set Light Mode (blue):**
```
01 00 08 45 01 00 00 00 00 FF 00 59 02
                  │  │  │
                  │  │  └── Blue (0x00)
                  │  └───── Green (0x00)
                  └──────── Red (0xFF)
```

---

### Tool Commands (0x70-0x7F)

| Command | Code | Arguments | Description |
|---------|------|-----------|-------------|
| Set Tool | `0x72` | `tool: u8, action: u8, ...` | Control tools |

**Tool Types:**
| Tool | Value | Actions |
|------|-------|---------|
| Stopwatch | `0x00` | `0x01` = Start, `0x00` = Stop |
| Noise Meter | `0x02` | `0x01` = Start, `0x00` = Stop |
| Countdown | `0x03` | `0x01` = Start, `0x00` = Stop |

**Countdown Arguments:**
```
[0x03, 0x01, minutes, seconds]
```

**Example - Start 5-minute countdown:**
```
01 00 06 72 03 01 05 00 00 81 02
                  │  │
                  │  └── Seconds (0)
                  └───── Minutes (5)
```

**Example - Start Noise Meter:**
```
01 00 04 72 02 01 00 7B 02
            │  │
            │  └── Start action
            └───── Tool: Noise Meter
```

---

### Animation Commands (0x60-0x6F)

| Command | Code | Arguments | Description |
|---------|------|-----------|-------------|
| Get Animation | `0x61` | None | Get current animation info |
| Send Image | `0x44` | Complex | Send static image (see notes) |
| Send Animation | `0x45` | Complex | Send animation frames |

**Note:** Image/animation commands are complex and typically handled by the `pixoo` crate. They involve:
- Chunking data into multiple packets
- Encoding pixel data in specific formats
- Handling acknowledgement responses

---

## Testing Commands

Use the `command_tester` utility to experiment:

```bash
cd backend
cargo run --example command_tester
```

### Recommended Testing Workflow

1. **Start with simple commands**: Test `0x44` (get brightness) - it's read-only and safe
2. **Verify connectivity**: If you get no responses, check your MAC address and Bluetooth pairing
3. **Test incrementally**: Start with one command type before moving to complex ones
4. **Document results**: Not all commands work on all firmware versions

### Quick Test Commands

```bash
# Set brightness to 50% (safe test)
echo -ne '\x01\x00\x04\x32\x80\x00\xB6\x02' > /dev/rfcomm0

# Get current brightness (read-only)
echo -ne '\x01\x00\x03\x44\x00\x48\x02' > /dev/rfcomm0
```

---

## Troubleshooting

### No Response from Device

1. **Check MAC address**: Verify with `bluetoothctl devices`
2. **Pairing**: Ensure device is paired: `bluetoothctl pair XX:XX:XX:XX:XX:XX`
3. **Connection**: RFCOMM channel is typically 1 or 4
4. **Sleep mode**: Device may be sleeping - press any button to wake

### Checksum Errors

- Verify you're using big-endian byte order
- Double-check that size = command (1) + args (N) + checksum (2) positions
- Some firmware versions may use little-endian - try both

### Partial Command Support

Different Pixoo models support different commands:

| Model | Clock | Light | Music | Buzzer | Tools |
|-------|-------|-------|-------|--------|-------|
| Pixoo-64 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Pixoo-Max | ✓ | ✓ | ✓ | ? | ? |
| Pixoo | ✓ | ✓ | ✓ | ? | Partial |

### Firmware Differences

- **Big-endian vs Little-endian**: Some versions swap byte order
- **Checksum method**: Most sum bytes 1..N-3, but some may differ
- **Response format**: Not all commands return responses

### Debug Tips

1. **Enable tracing**: Set `RUST_LOG=trace` when running tests
2. **Use hex dumps**: Log all bytes sent/received
3. **Test one change at a time**: Isolate variables
4. **Compare with official app**: Use packet sniffer to capture official app traffic

---

## References

- [pixoo crate documentation](https://docs.rs/pixoo/)
- Bluetooth Serial Profile (SPP) specification
- Divoom official app (for reverse engineering)

---

## Contributing

If you discover new commands or variations, please document them here with:
- Command byte value
- Argument format
- Tested device model
- Firmware version (if known)
