# Pixoo Bluetooth Protocol

How pxls talks to legacy Divoom Pixoo (16x16) displays. The implementation lives in `backend/src/device/` and is written from this document, public protocol write-ups and observed app behavior. It does not use or derive from any third-party driver source.

**Status legend.** *Public* = layout documented by a public write-up. *Repo* = layout taken from this repository's earlier notes or the app's own behavior. *Inferred* = our mapping, no document states it. Everything marked *needs device test* has not been confirmed against real hardware; the checklist at the end says how to confirm each one.

## Sources

- **[Timebox Evo protocol write-up](https://github.com/RomRider/node-divoom-timebox-evo/blob/master/PROTOCOL.md)** (public, no license stated; only facts were used): framing, little-endian fields, checksum, brightness `0x74`, channels `0x45 00/01/03/04/06`, image upload layout.
- **[Timebox (Mini) protocol write-up](https://github.com/MarcG046/timebox/blob/master/doc/protocol.md)** (public, no license stated): framing, escaping rule (not used, see below), static image command number.
- **This repository's earlier notes and app code**: tool command `0x72` layouts, scoreboard tool `0x50`.

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
| Visualization ("music") | `0x45` | `04 TT` | Public layout, Inferred mapping | needs device test |
| User mode | `0x45` | `05 00` | Inferred | needs device test |
| Scoreboard mode | `0x45` | `06 00 red_lo red_hi blue_lo blue_hi` | Public | needs device test |
| Image | `0x44` | see below | Public (Timebox family) | needs device test |
| Stopwatch tool | `0x72` | `00 action` (1 start, 0 stop) | Repo | needs device test |
| Noise meter tool | `0x72` | `02 action` | Repo | needs device test |
| Countdown tool | `0x72` | `03 action minutes seconds` | Repo | needs device test |
| Scoreboard tool | `0x50` | `on red_lo red_hi blue_lo blue_hi` | Repo (app behavior) | **not used by the app**: on a real Pixoo it showed a logo (Instagram) instead of a scoreboard; encoder kept, unverified |

Notes:

- **Clock `TT`:** 0 digital, 1 rainbow, 2 box, 3 analog 1, 4 inverted, 5 analog 2. Byte 3 of the clock args (`01`) is "fixed" in the write-up; it might be a 24h flag, which is untested (the 12/24h setting was removed from pxls). The app's `show_divoom` flag has no known byte and is ignored.
- **Light effect:** 0 normal, 1 rainbow ("love" in the write-up), 2 plants, 3 fly ("no mosquito"), 4 sleep.
- **Music `TT`** (observed on a real Pixoo, not documented): 0 bottom bars, 1 face 3, 2 center bars, 3 face 1, 4 matrix, 5 frog face, 6 side bars, 7 face 2, 8 falling blocks, 9 dancing boy, 10 fireworks, 11 dancing girl.
- **Stopwatch pause/reset** are not documented and not implemented.
- **Tool layouts:** the old notes' example packets for tools had lengths that did not match their arguments; the argument lists above are used, framed as in the table above.
- **Score range:** 0-999 (the driver clamps larger values), confirmed by the public write-up and a device observation that 99 was too low.
- **Scoreboard:** mode `0x45 06` and tool `0x50` are different things. The Tools page and `/api/scoreboard` use mode `0x45 06`, the same command Device config sends, on the open link; each +/- sends one packet (the UI debounces and sends the latest value). `0x50` flashed a logo on a real Pixoo, so the app no longer sends it. Whether `0x45 06` updates live from rapid clicks needs a device test.
- **Tools and the link:** countdown (`0x72 03`), sound detector (`0x72 02`) and the scoreboard are sent on the already-open link, which stays open. When a tool ends (timer expiry or Stop) the app re-applies the device config on that same link, with no reconnect; Stop first sends the tool's own stop (`0x72 03 00 00 00` / `0x72 02 00`). Whether the display returns this way, and whether the device keeps a tool running with the link open, needs a device test. Fallback: `PXLS_TOOL_CLOSE_LINK=1` closes the link after a tool is sent and the render loop reconnects when it ends, retrying every 2 s.
- **Tool timing:** the backend keeps one record of the running tool (kind and end time). The countdown ends after its set time and the sound detector after 5 minutes (a UI assumption, the noise meter has no end of its own); the scoreboard has no timer.

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

## Diagnostics page (admin only)

Set `PXLS_ENABLE_DEBUG=1` in `.env` and restart the backend; admins then get a **Diagnostics** tab. It sends a raw command (framing and checksum added) through the connected device, can show solid red first so ignored commands are obvious, steps through a value range, and keeps a log with notes you can copy. After each send the display loop is paused for two minutes. The endpoint (`POST /api/debug/send`) is admin only and returns 403 while the flag is off. **Restore display** (`POST /api/debug/release`, same rules) ends the pause and re-applies your configured mode on the open link, for when a probe leaves the display stuck (for example on the red screen). Turn the flag off again when you are done.

## Device test checklist

Run on the server with a real Pixoo and note the model and firmware. Tick each item or record what the display did.

1. **Connect and brightness.** Connect from the UI, set brightness 10, 50, 100. Display should change. If nothing happens, run `command_tester` brightness: it sends the `0x74` and the old `0x32` forms. If only a big-endian packet works, framing is wrong and everything else is moot.
2. **Native modes.** Apply clock (each of 6 designs, with weather/temp/date on and off), light (color, brightness, 5 effects, on/off), music (12 modes), user, score. Record which work. Watch for the clock, blank, clock flicker.
3. **Tools on the open link.** Start a 1 minute countdown, sound detector and the scoreboard (Tools page) and check each runs with the status still "Connected". Check the display returns by itself when the countdown ends and on Stop, and how many seconds that takes. If a tool does not run or the display does not return, try `PXLS_TOOL_CLOSE_LINK=1`.
4. **Escaping.** Set brightness to 1 (argument `0x01`). If the display ignores it or misbehaves, the device needs escaped packets.
5. **Images.** Push each page type (text, image, scroll). Check colors, orientation and no garbage. If the image is shifted or the device ignores it, `LEN` semantics are the first suspect.
6. **Clock byte 3.** Compare 12h vs 24h display with the app set to each; see if that byte is a 24h flag (a prerequisite for bringing the 12/24h setting back).
7. **Responses.** The driver never reads. Leave the server running for a few hours with the render loop active and confirm no stalls (unread device replies could fill the socket buffer).
8. **Reconnect.** Power cycle the display; confirm the loop reconnects.

## Troubleshooting

- **No response:** check the MAC (`bluetoothctl devices`), pairing, and that the display is awake.
- **Connection errors** containing "transport endpoint", "not connected" or "107" make the render loop reconnect.
- Enable `RUST_LOG=pxls_backend::device=trace` to log every packet in hex.

## Contributing

If you confirm or correct a command, update the table with the command byte, arguments, device model and firmware.
