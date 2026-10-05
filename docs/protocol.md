# Pixoo Bluetooth Protocol

How pxls talks to legacy Divoom Pixoo (16x16) displays. The implementation lives in `backend/src/device/` and is written from this document, public protocol write-ups and observed app behavior. It does not use or derive from any third-party driver source.

**Status legend.** *Public* = layout documented by a public write-up. *Repo* = layout taken from this repository's earlier notes or the app's own behavior. *Inferred* = our mapping, no document states it. Everything marked *needs device test* has not been confirmed against real hardware; the checklist at the end says how to confirm each one.

## Sources

- **[Timebox Evo protocol write-up](https://github.com/RomRider/node-divoom-timebox-evo/blob/master/PROTOCOL.md)** (public, no license stated; only facts were used): framing, little-endian fields, checksum, brightness `0x74`, channels `0x45 00/01/03/04/06`, image upload layout.
- **[Timebox (Mini) protocol write-up](https://github.com/MarcG046/timebox/blob/master/doc/protocol.md)** (public, no license stated): framing, escaping rule (not used, see below), static image command number.
- **This repository's earlier notes and app code**: tool command `0x72` layouts, scoreboard tool `0x50`, buzzer `0x31`.

Both public write-ups cover the Timebox family. Pixoo behaviour is assumed to match where noted.

## Transport

Bluetooth RFCOMM (serial port profile). The driver connects with `bluetooth-serial-port`, writes whole packets and flushes. It does not read responses. Dropping the `Pixoo` value or calling `disconnect()` closes the socket.

## Packet framing

```
01 | LEN_LO LEN_HI | CMD | ARGS... | SUM_LO SUM_HI | 02
```

| Field | Size | Meaning |
|-------|------|---------|
| Start | 1 | `0x01` |
| Length | 2 | little-endian: `1 (cmd) + args + 2 (checksum)` |
| Command | 1 | command byte |
| Args | N | command specific |
| Checksum | 2 | little-endian 16-bit sum of every byte from Length through the last arg |
| End | 1 | `0x02` |

Example, brightness 50%: `01 04 00 74 32 AA 00 02` (`0x04 + 0x74 + 0x32 = 0xAA`).

**Correction to earlier notes:** this file used to describe big-endian length and checksum and brightness command `0x32` with a 0-255 range. The public write-ups say little-endian and `0x74` with 0-100. The old example `01 00 04 32 80 00 B6 02` has the same size and checksum value as ours; only the byte order of the two 16-bit fields differs. `command_tester` can still send the big-endian form for comparison.

**Escaping:** the Timebox Mini write-up says `01`, `02`, `03` bytes inside a packet are escaped (`03 04`, `03 05`, `03 06`). The Evo write-up documents commands with `01` arguments (clock header, light power) without escaping, so pxls sends raw bytes. *Needs device test* (step 6).

## Commands

| Command | Code | Args | Source | Status |
|---------|------|------|--------|--------|
| Brightness | `0x74` | `percent: u8` (0-100) | Public | needs device test on Pixoo |
| Clock mode | `0x45` | `00 01 TT show_time show_weather show_temp show_date R G B` | Public | needs device test |
| Light mode | `0x45` | `01 R G B brightness effect power 00 00 00` | Public | needs device test |
| Effects ("special") | `0x45` | `03 TT` | Public layout, Inferred mapping | needs device test |
| Visualization ("music") | `0x45` | `04 TT` | Public layout, Inferred mapping | needs device test |
| User mode | `0x45` | `05 00` | Inferred | needs device test |
| Scoreboard mode | `0x45` | `06 00 red_lo red_hi blue_lo blue_hi` | Public | needs device test |
| Image | `0x44` | see below | Public (Timebox family) | needs device test |
| Time format | unknown | n/a | none | **not sent** |
| Buzzer | `0x31` | `total_ms: u16` little-endian | Repo (previous behavior) | needs device test |
| Stopwatch tool | `0x72` | `00 action` (1 start, 0 stop) | Repo | needs device test |
| Noise meter tool | `0x72` | `02 action` | Repo | needs device test |
| Countdown tool | `0x72` | `03 action minutes seconds` | Repo | needs device test |
| Scoreboard tool | `0x50` | `on red_lo red_hi blue_lo blue_hi` | Repo (app behavior) | needs device test |

Notes:

- **Clock `TT`:** 0 digital, 1 rainbow, 2 box, 3 analog 1, 4 inverted, 5 analog 2. Byte 3 of the clock args (`01`) is "fixed" in the write-up; it might be a 24h flag. The app's `show_divoom` flag has no known byte and is ignored.
- **Light effect:** 0 normal, 1 rainbow ("love" in the write-up), 2 plants, 3 fly ("no mosquito"), 4 sleep.
- **Music `TT`:** 0 bottom bars, 1 center bars, 2 side bars, 3 face 1, 4 face 2, 5 face 3, 6 frog face, 7 matrix, 8 falling blocks, 9 fireworks, 10 dancing boy, 11 dancing girl. The order is our own; the write-up only says "see image".
- **Time format:** no command is documented anywhere we looked. `Pixoo::set_time_format` sends nothing until `CMD_TIME_FORMAT` in `backend/src/device/mod.rs` is set after a device test. The 12/24h setting therefore has no effect for now.
- **Buzzer:** an earlier implementation also sent `0x45 06 00` after the buzzer. The scoreboard channel is `06`, so that was removed. Other buzzer layouts (4 and 6 byte, big-endian) were tried historically; the 2-byte little-endian form is what pxls sent before and is kept.
- **Stopwatch pause/reset** are not documented and not implemented.
- **Tool layouts:** the old notes' example packets for tools had lengths that did not match their arguments; the argument lists above are used, framed as in the table above.
- **Scoreboard:** mode `0x45 06` and tool `0x50` are different things. The app uses the tool for `/api/tools/scoreboard`, because the device keeps running it on its own.

### Image upload (`0x44`)

Args: `00 0A 0A 04 | AA LEN_LO LEN_HI 00 00 00 NN PALETTE PIXELS`

- `NN` palette size (`00` means 256), `PALETTE` is `NN` RGB triples in order of first use.
- `PIXELS`: one palette index per pixel, row by row from the top left, `ceil(log2(NN))` bits each (minimum 1), filled least-significant bit first, last byte zero padded.
- `LEN` is assumed to be the whole frame length from `AA` through the last pixel byte (the write-up says only "image data length"). *Assumption, needs device test.*
- Sent as one packet, no chunking. Non-16x16 images are resized (nearest neighbour).

## Connection lifecycle

- `Pixoo::connect(addr)` opens the RFCOMM socket. `Pixoo::disconnect()` closes it explicitly and is idempotent. Dropping a `Pixoo` closes it too. Sends after disconnect fail with "not connected".
- The previous driver had no `Drop`, so the `drop(pixoo)` calls after countdown, sound detector and scoreboard never closed anything. Now they do. Whether the display keeps running those tools after the link closes is *unconfirmed* (device test step 3).
- The render loop's cadence is unchanged: no heartbeat in native mode, native modes reapplied every ~10 s.

## Testing

```bash
cd backend
cargo test device         # golden byte tests with a mock transport
cargo run --example command_tester
cargo run --example library_tool_test
```

Quick raw test (documented brightness, 50%):

```bash
echo -ne '\x01\x04\x00\x74\x32\xAA\x00\x02' > /dev/rfcomm0
```

## Device test checklist

Run on the server with a real Pixoo and note the model and firmware. Tick each item or record what the display did.

1. **Connect and brightness.** Connect from the UI, set brightness 10, 50, 100. Display should change. If nothing happens, run `command_tester` brightness: it sends the `0x74` and the old `0x32` forms. If only a big-endian packet works, framing is wrong and everything else is moot.
2. **Native modes.** Apply clock (each of 6 designs, with weather/temp/date on and off), light (color, brightness, 5 effects, on/off), special (4 modes), music (12 modes), user, score. Record which work. Watch for the clock, blank, clock flicker.
3. **Tools survive disconnect.** Start a 1 minute countdown, then check the display keeps counting after the log says "Disconnected". Repeat for sound detector and scoreboard tool. If the tool stops when the link closes, delay the close.
4. **Time format.** Find the command (try the official app with a sniffer, or `command_tester` scan), then set `CMD_TIME_FORMAT`.
5. **Buzzer.** Trigger it. Silence means the layout is wrong; try the variants in `command_tester`.
6. **Escaping.** Set brightness to 1 (argument `0x01`). If the display ignores it or misbehaves, the device needs escaped packets.
7. **Images.** Push each page type (text, image, scroll). Check colors, orientation and no garbage. If the image is shifted or the device ignores it, `LEN` semantics are the first suspect.
8. **Clock byte 3.** Compare 12h vs 24h display with the app set to each; see if that byte is a 24h flag.
9. **Responses.** The driver never reads. Leave the server running for a few hours with the render loop active and confirm no stalls (unread device replies could fill the socket buffer).
10. **Reconnect.** Power cycle the display; confirm the loop reconnects.

## Troubleshooting

- **No response:** check the MAC (`bluetoothctl devices`), pairing, and that the display is awake.
- **Connection errors** containing "transport endpoint", "not connected" or "107" make the render loop reconnect.
- Enable `RUST_LOG=pxls_backend::device=trace` to log every packet in hex.

## Contributing

If you confirm or correct a command, update the table with the command byte, arguments, device model and firmware.
